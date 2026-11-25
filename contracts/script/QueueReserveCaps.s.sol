// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {TokenConfig} from "../src/Types.sol";
import {DateLib} from "../src/lib/DateLib.sol";

// The Base mainnet MandateVault (deployments/README.md).
address constant LIVE_VAULT = 0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b;
// The new per-token weight cap. A BUY is refused with CONCENTRATION when it would take the bought token above
// this share of the vault's equity (MandateVault._weightAfterBuyBps).
uint16 constant RESERVE_CAP_BPS = 2500;

interface ITokenSymbol {
    function symbol() external view returns (string memory);
}

/// @notice Prints the owner's `cast send` lines that lower maxWeightBps to RESERVE_CAP_BPS on every token the
/// vault lists: one queueTokenConfig and one applyTokenConfig per token. Every other field (allowed, feed, pool)
/// is copied from the vault's current tokenConfig, so only the cap changes. The script only reads the vault and
/// prints; it sends nothing and needs no key:
///
///   forge script script/QueueReserveCaps.s.sol --fork-url https://mainnet.base.org
///
/// Run it again after queueing: for each queued change it prints the earliest and the last time to apply it.
contract QueueReserveCaps is Script {
    string internal constant RPC = "https://mainnet.base.org";
    string internal constant SEND_FLAGS = " --account maat-owner --rpc-url https://mainnet.base.org";
    string internal constant QUEUE_SIG = "queueTokenConfig(address,(bool,address,address,uint16))";
    string internal constant APPLY_SIG = "applyTokenConfig(address,(bool,address,address,uint16))";

    struct Change {
        address token;
        string symbol;
        TokenConfig current;
        TokenConfig next;
        /// MandateVault.tokenChangeHash(token, next), the key of queuedAt
        bytes32 changeHash;
        /// MandateVault.queuedAt(changeHash): 0 until the queue tx lands
        uint256 queuedAt;
    }

    function run() external view {
        MandateVault vault = MandateVault(LIVE_VAULT);
        Change[] memory c = changes(vault);
        uint256 timelock = vault.TIMELOCK();
        uint256 grace = vault.GRACE_PERIOD();

        console2.log("MandateVault", vm.toString(address(vault)));
        console2.log(
            "owner (queue and apply revert NotOwner for any other sender)", vm.toString(vault.owner())
        );
        console2.log(
            string.concat(
                "TIMELOCK ",
                vm.toString(timelock),
                " s, GRACE_PERIOD ",
                vm.toString(grace),
                " s, read at block ",
                vm.toString(block.number),
                " (",
                utc(block.timestamp),
                ")"
            )
        );
        console2.log("");
        for (uint256 i; i < c.length; ++i) {
            console2.log(string.concat(c[i].symbol, " ", vm.toString(c[i].token)));
            console2.log(string.concat("  now  ", tuple(c[i].current)));
            console2.log(string.concat("  next ", tuple(c[i].next)));
            console2.log(string.concat("  change hash ", vm.toString(c[i].changeHash)));
            if (c[i].current.maxWeightBps == RESERVE_CAP_BPS) {
                console2.log("  already at the reserve cap: nothing to queue or apply");
            } else if (c[i].queuedAt == 0) {
                console2.log("  not queued yet");
            } else {
                uint256 eta = c[i].queuedAt + timelock;
                console2.log(string.concat("  queued ", utc(c[i].queuedAt)));
                console2.log(string.concat("  apply from ", utc(eta), " until ", utc(eta + grace)));
            }
        }

        console2.log("");
        console2.log(
            "1. Queue. Send the lines one after the other; each starts its own TIMELOCK at its block's time."
        );
        for (uint256 i; i < c.length; ++i) {
            if (c[i].current.maxWeightBps != RESERVE_CAP_BPS) {
                console2.log(queueCommand(address(vault), c[i].token, c[i].next));
            }
        }
        console2.log("");
        console2.log(
            string.concat(
                "2. Apply, each line ",
                vm.toString(timelock),
                " s or more after its queue tx and at most ",
                vm.toString(grace),
                " s after that (earlier reverts ChangeNotReady, later ChangeExpired):"
            )
        );
        for (uint256 i; i < c.length; ++i) {
            if (c[i].current.maxWeightBps != RESERVE_CAP_BPS) {
                console2.log(applyCommand(address(vault), c[i].token, c[i].next));
            }
        }
        console2.log("");
        console2.log(
            "3. Check (read-only, no key). queuedAt is 0 before the queue tx and again after the apply:"
        );
        for (uint256 i; i < c.length; ++i) {
            console2.log(
                string.concat(
                    "cast call ",
                    vm.toString(address(vault)),
                    ' "queuedAt(bytes32)(uint256)" ',
                    vm.toString(c[i].changeHash),
                    " --rpc-url ",
                    RPC
                )
            );
        }
        for (uint256 i; i < c.length; ++i) {
            console2.log(
                string.concat(
                    "cast call ",
                    vm.toString(address(vault)),
                    ' "tokenConfig(address)(bool,address,address,uint16)" ',
                    vm.toString(c[i].token),
                    " --rpc-url ",
                    RPC
                )
            );
        }
    }

    /// @notice One change per listed token, in tokens() order: its current config with only maxWeightBps
    /// replaced by RESERVE_CAP_BPS. Reverts if a listed token is not an allowed market.
    function changes(MandateVault vault) public view returns (Change[] memory c) {
        address[] memory toks = vault.tokens();
        c = new Change[](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            (bool allowed, address feed, address pool, uint16 weight) = vault.tokenConfig(toks[i]);
            require(
                allowed && feed != address(0) && pool != address(0), "listed token is not an allowed market"
            );
            TokenConfig memory current =
                TokenConfig({allowed: allowed, feed: feed, pool: pool, maxWeightBps: weight});
            TokenConfig memory next = withReserveCap(current);
            bytes32 h = vault.tokenChangeHash(toks[i], next);
            c[i] = Change({
                token: toks[i],
                symbol: symbolOf(toks[i]),
                current: current,
                next: next,
                changeHash: h,
                queuedAt: vault.queuedAt(h)
            });
        }
    }

    /// @notice A new config equal to `c` except maxWeightBps = RESERVE_CAP_BPS (a copy: `c` is not modified).
    function withReserveCap(TokenConfig memory c) public pure returns (TokenConfig memory) {
        return TokenConfig({allowed: c.allowed, feed: c.feed, pool: c.pool, maxWeightBps: RESERVE_CAP_BPS});
    }

    function queueCommand(address vault, address token, TokenConfig memory c)
        public
        pure
        returns (string memory)
    {
        return _send(vault, QUEUE_SIG, token, c);
    }

    function applyCommand(address vault, address token, TokenConfig memory c)
        public
        pure
        returns (string memory)
    {
        return _send(vault, APPLY_SIG, token, c);
    }

    /// @notice The TokenConfig as a cast tuple argument: (allowed,feed,pool,maxWeightBps).
    function tuple(TokenConfig memory c) public pure returns (string memory) {
        return string.concat(
            "(",
            vm.toString(c.allowed),
            ",",
            vm.toString(c.feed),
            ",",
            vm.toString(c.pool),
            ",",
            vm.toString(uint256(c.maxWeightBps)),
            ")"
        );
    }

    /// @notice `ts` as "YYYY-MM-DD HH:MM:SS UTC".
    function utc(uint256 ts) public pure returns (string memory) {
        (uint256 y, uint256 m, uint256 d) = DateLib.civilFromDays(ts / 1 days);
        uint256 s = ts % 1 days;
        return string.concat(
            vm.toString(y),
            "-",
            _two(m),
            "-",
            _two(d),
            " ",
            _two(s / 3600),
            ":",
            _two((s / 60) % 60),
            ":",
            _two(s % 60),
            " UTC"
        );
    }

    function symbolOf(address token) public view returns (string memory) {
        try ITokenSymbol(token).symbol() returns (string memory s) {
            return s;
        } catch {
            return "token";
        }
    }

    function _send(address vault, string memory sig, address token, TokenConfig memory c)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "cast send ",
            vm.toString(vault),
            ' "',
            sig,
            '" ',
            vm.toString(token),
            ' "',
            tuple(c),
            '"',
            SEND_FLAGS
        );
    }

    function _two(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", vm.toString(v)) : vm.toString(v);
    }
}
