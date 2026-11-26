// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {IMandateVaultEvents} from "../../src/IMandateVaultEvents.sol";
import {Action, Reason, Intent} from "../../src/Types.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

/// @notice The deployed Base mainnet vault, called the way the agent will call it: `execute(intent)` calldata, then
/// a printable rationale blob, then an ERC-8021 data suffix, with `intent.rationaleHash = keccak256(blob)`. The
/// vault never reads the bytes after the ABI-encoded intent, so the Decision must carry the blob's hash and agree
/// with `previewIntent` on the same intent. Fork only: the executor is impersonated with `vm.prank`.
contract MandateVaultTrailingRationaleForkTest is Test {
    /// Records in deployments/README.md (deployed 2026-11-24).
    MandateVault internal constant VAULT = MandateVault(0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b);
    address internal constant CALENDAR = 0x9bfe055323101245a644AF162287C4C38708aDB1;
    /// executor() and the only allowlisted payee at FORK_BLOCK.
    address internal constant EXECUTOR = 0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a;

    /// Wed 2026-11-25 05:35:24 UTC (00:35 ET, NYSE closed), read with `cast block-number` on a public RPC.
    uint256 internal constant FORK_BLOCK = 61_972_742;

    /// The rationale blob's size cap: the largest blob this test sends.
    uint256 internal constant MAX_BLOB = 1024;
    /// execute(Intent): a 4-byte selector and the static 7-word Intent.
    uint256 internal constant EXECUTE_LEN = 4 + 7 * 32;

    /// The ERC-8021 example code and its schema-0 suffix, the test vector of agent/test/builderCode.test.ts.
    string internal constant EXAMPLE_CODE = "bc_a1b2c3d4";
    bytes internal constant SUFFIX_VECTOR = hex"62635f61316232633364340b0080218021802180218021802180218021";
    bytes16 internal constant ERC8021_MARKER = 0x80218021802180218021802180218021;

    struct Decided {
        bool allowed;
        Reason reason;
        bytes32 rationaleHash;
    }

    /// Who sends and who is paid: EXECUTOR at FORK_BLOCK. LiveVaultTrailingRationaleFork.t.sol runs these calls at
    /// the live block and reads both from the vault there.
    address internal executor = EXECUTOR;
    address internal payee = EXECUTOR;

    function setUp() public virtual {
        vm.createSelectFork("base", FORK_BLOCK);
        assertEq(VAULT.executor(), EXECUTOR);
        assertEq(VAULT.mandate().calendar, CALENDAR);
        assertTrue(VAULT.allowedPayee(EXECUTOR));
        assertFalse(VAULT.paused());
    }

    function test_refusedBuyCarriesTheBlobHash() public virtual {
        bytes memory blob = _blob(512);
        Intent memory i = _intent("b1-refused-buy", Action.BUY, A.GOOGLC, 1e6, address(0), blob);
        Decided memory d = _executeWithTrailer(i, blob);
        assertFalse(d.allowed);
        assertEq(uint8(d.reason), uint8(Reason.MARKET_CLOSED));
    }

    function test_allowedExpenseCarriesTheBlobHash() public virtual {
        uint256 vaultBefore = IERC20Minimal(A.USDC).balanceOf(address(VAULT));
        uint256 payeeBefore = IERC20Minimal(A.USDC).balanceOf(payee);
        bytes memory blob = _blob(512);
        Intent memory i = _intent("b1-allowed-expense", Action.PAY_EXPENSE, A.USDC, 0.1e6, payee, blob);
        Decided memory d = _executeWithTrailer(i, blob);
        assertTrue(d.allowed);
        assertEq(uint8(d.reason), uint8(Reason.OK));
        assertEq(IERC20Minimal(A.USDC).balanceOf(address(VAULT)), vaultBefore - 0.1e6);
        assertEq(IERC20Minimal(A.USDC).balanceOf(payee), payeeBefore + 0.1e6);
    }

    function test_blobAtExactly1024Bytes() public virtual {
        bytes memory blob = _blob(MAX_BLOB);
        assertEq(blob.length, 1024);

        Intent memory buy = _intent("b1-cap-buy", Action.BUY, A.NVDAC, 1e6, address(0), blob);
        Decided memory d = _executeWithTrailer(buy, blob);
        assertFalse(d.allowed);
        assertEq(uint8(d.reason), uint8(Reason.MARKET_CLOSED));

        Intent memory pay = _intent("b1-cap-expense", Action.PAY_EXPENSE, A.USDC, 0.1e6, payee, blob);
        d = _executeWithTrailer(pay, blob);
        assertTrue(d.allowed);
        assertEq(uint8(d.reason), uint8(Reason.OK));
    }

    function test_suffixMatchesTheAgentTestVector() public pure {
        assertEq(_suffix(EXAMPLE_CODE), SUFFIX_VECTOR);
        assertEq(SUFFIX_VECTOR.length, 29);
    }

    // ------------------------------------------------------------------ helpers

    /// Sends `execute(i) ‖ blob ‖ suffix` as the executor and checks the Decision against the intent and the preview.
    function _executeWithTrailer(Intent memory i, bytes memory blob) internal returns (Decided memory d) {
        assertLe(blob.length, MAX_BLOB);
        assertEq(i.rationaleHash, keccak256(blob));
        assertFalse(VAULT.usedIntent(i.id));
        bytes memory trailer = _trailer(blob);

        Reason previewed = _preview(i, trailer);
        d = _send(i, trailer);
        assertEq(d.rationaleHash, keccak256(blob));
        assertEq(uint8(d.reason), uint8(previewed));
        assertEq(d.allowed, previewed == Reason.OK);
        assertTrue(VAULT.usedIntent(i.id));
    }

    /// The bytes after the ABI-encoded call: the blob, then the suffix the agent's sender appends. The suffix comes
    /// from `_suffix`, which test_suffixMatchesTheAgentTestVector pins to the agent's vector.
    function _trailer(bytes memory blob) internal pure returns (bytes memory t) {
        t = bytes.concat(blob, _suffix(EXAMPLE_CODE));
        assertEq(t.length, blob.length + 29);
    }

    /// The agent previews with a plain eth_call from the executor before it sends. The same trailer on the preview
    /// call must not change its verdict either.
    function _preview(Intent memory i, bytes memory trailer) internal returns (Reason previewed) {
        vm.prank(executor, executor);
        previewed = VAULT.previewIntent(i);
        vm.prank(executor, executor);
        (bool ok, bytes memory ret) =
            address(VAULT).staticcall(bytes.concat(abi.encodeCall(MandateVault.previewIntent, (i)), trailer));
        assertTrue(ok, "previewIntent with a trailer reverted");
        assertEq(uint8(abi.decode(ret, (Reason))), uint8(previewed));
    }

    /// Sends the call; the Decision must match the call's return values and carry the intent's rationaleHash.
    function _send(Intent memory i, bytes memory trailer) internal returns (Decided memory d) {
        bytes memory data = _executeCalldata(i, trailer);
        vm.recordLogs();
        vm.prank(executor, executor);
        (bool ok, bytes memory ret) = address(VAULT).call(data);
        assertTrue(ok, "execute with a trailing blob and suffix reverted");
        d = _onlyDecision(vm.getRecordedLogs(), i);
        (bool allowed, Reason reason) = abi.decode(ret, (bool, Reason));
        assertEq(d.allowed, allowed);
        assertEq(uint8(d.reason), uint8(reason));
        assertEq(d.rationaleHash, i.rationaleHash);
    }

    function _executeCalldata(Intent memory i, bytes memory trailer)
        internal
        pure
        returns (bytes memory data)
    {
        bytes memory plain = abi.encodeCall(MandateVault.execute, (i));
        assertEq(plain.length, EXECUTE_LEN);
        data = bytes.concat(plain, trailer);
        assertEq(_codeFromTail(data, EXECUTE_LEN + trailer.length - 29), EXAMPLE_CODE);
    }

    function _onlyDecision(Vm.Log[] memory logs, Intent memory i) internal pure returns (Decided memory d) {
        uint256 found;
        for (uint256 k; k < logs.length; ++k) {
            Vm.Log memory e = logs[k];
            if (e.emitter != address(VAULT) || e.topics.length == 0) continue;
            if (e.topics[0] != IMandateVaultEvents.Decision.selector) continue;
            ++found;
            assertEq(e.topics[1], i.id);
            assertEq(address(uint160(uint256(e.topics[2]))), i.token);
            (Action action, uint256 amount, bool allowed, Reason reason, bytes32 rh) =
                abi.decode(e.data, (Action, uint256, bool, Reason, bytes32));
            assertEq(uint8(action), uint8(i.action));
            assertEq(amount, i.amount);
            d = Decided(allowed, reason, rh);
        }
        assertEq(found, 1, "expected exactly one Decision");
    }

    function _intent(
        string memory salt,
        Action action,
        address token,
        uint256 amount,
        address payee,
        bytes memory blob
    ) internal pure returns (Intent memory) {
        return Intent({
            id: keccak256(bytes(salt)),
            action: action,
            token: token,
            amount: amount,
            minOut: 0,
            payee: payee,
            rationaleHash: keccak256(blob)
        });
    }

    /// A printable `maat:v1:` JSON blob of exactly `len` bytes; the vault never parses it.
    function _blob(uint256 len) internal pure returns (bytes memory b) {
        bytes memory head = bytes('maat:v1:{"m":"fork-test","t":"');
        require(len >= head.length + 2, "blob too short");
        b = new bytes(len);
        for (uint256 k; k < head.length; ++k) {
            b[k] = head[k];
        }
        for (uint256 k = head.length; k < len - 2; ++k) {
            b[k] = bytes1(uint8(0x61 + (k % 26))); // a-z
        }
        b[len - 2] = '"';
        b[len - 1] = "}";
    }

    /// ERC-8021 schema 0: the code bytes, their length, the schema id 0, then the 16-byte marker.
    function _suffix(string memory code) internal pure returns (bytes memory) {
        bytes memory c = bytes(code);
        return abi.encodePacked(c, uint8(c.length), uint8(0), ERC8021_MARKER);
    }

    /// Reads a schema-0 code back from the end of the calldata, the way an ERC-8021 parser does. The suffix it finds
    /// must start at `expectedStart`, right after the blob, and never before the end of execute(intent) at byte 228,
    /// so a reader that splits the calldata from the tail gets back the same blob the test sent.
    function _codeFromTail(bytes memory data, uint256 expectedStart) internal pure returns (string memory) {
        uint256 n = data.length;
        assertGe(n, EXECUTE_LEN + 18);
        bytes32 word;
        assembly ("memory-safe") {
            word := mload(add(add(data, 32), sub(n, 16)))
        }
        assertEq(bytes16(word), ERC8021_MARKER);
        assertEq(uint8(data[n - 17]), 0); // schema id
        uint256 len = uint8(data[n - 18]);
        uint256 start = n - 18 - len;
        assertGe(start, EXECUTE_LEN, "suffix starts inside execute(intent)");
        assertEq(start, expectedStart, "suffix does not start right after the blob");
        bytes memory code = new bytes(len);
        for (uint256 k; k < len; ++k) {
            code[k] = data[start + k];
        }
        return string(code);
    }
}
