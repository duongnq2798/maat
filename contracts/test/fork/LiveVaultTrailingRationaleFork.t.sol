// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Reason, Intent} from "../../src/Types.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {LIVE_VAULT} from "../../script/QueueReserveCaps.s.sol";
import {MandateVaultTrailingRationaleForkTest} from "./MandateVaultTrailingRationaleFork.t.sol";
import {LiveFork} from "./live/LiveFork.sol";

/// @notice MandateVaultTrailingRationaleForkTest at the pinned live block instead of its fixed one: the same
/// `execute(intent) ‖ blob ‖ ERC-8021 suffix` calls and the same checks on the Decision and the preview, sent as
/// whoever holds the executor role at that block and paying its first allowlisted payee. The market may be open at
/// that block, so the refused BUY asks for more than the per-trade cap, which no hour allows. Run by
/// .github/workflows/live-fork.yml.
contract LiveVaultTrailingRationaleForkTest is MandateVaultTrailingRationaleForkTest, LiveFork {
    uint256 internal constant EXPENSE = 0.1e6;

    function setUp() public override {
        _selectLiveFork();
        assertEq(address(VAULT), LIVE_VAULT);
        executor = VAULT.executor();
        address[] memory payees = VAULT.payees();
        assertGt(payees.length, 0, "the live vault allowlists no payee");
        payee = payees[0];
        _fundAsOwner(1e6); // so the payments below never meet INSUFFICIENT_BALANCE
    }

    function test_refusedBuyCarriesTheBlobHash() public override {
        bytes memory blob = _blob(512);
        Decided memory d = _executeWithTrailer(_overCapBuy("live-refused-buy", blob), blob);
        assertFalse(d.allowed);
    }

    function test_allowedExpenseCarriesTheBlobHash() public override {
        uint256 vaultBefore = IERC20Minimal(VAULT.usdc()).balanceOf(address(VAULT));
        uint256 payeeBefore = IERC20Minimal(VAULT.usdc()).balanceOf(payee);
        Reason want = _expenseReason();
        bytes memory blob = _blob(512);
        Intent memory i =
            _intent("live-allowed-expense", Action.PAY_EXPENSE, VAULT.usdc(), EXPENSE, payee, blob);
        Decided memory d = _executeWithTrailer(i, blob);
        assertEq(uint8(d.reason), uint8(want));
        uint256 paid = want == Reason.OK ? EXPENSE : 0;
        assertEq(IERC20Minimal(VAULT.usdc()).balanceOf(address(VAULT)), vaultBefore - paid);
        assertEq(IERC20Minimal(VAULT.usdc()).balanceOf(payee), payeeBefore + paid);
    }

    function test_blobAtExactly1024Bytes() public override {
        bytes memory blob = _blob(MAX_BLOB);
        assertEq(blob.length, 1024);

        Decided memory d = _executeWithTrailer(_overCapBuy("live-cap-buy", blob), blob);
        assertFalse(d.allowed);

        Reason want = _expenseReason();
        Intent memory pay =
            _intent("live-cap-expense", Action.PAY_EXPENSE, VAULT.usdc(), EXPENSE, payee, blob);
        d = _executeWithTrailer(pay, blob);
        assertEq(uint8(d.reason), uint8(want));
    }

    // ------------------------------------------------------------------ helpers

    /// A BUY of the first listed token for one micro-USDC over the per-trade cap: refused at any hour, by the market
    /// checks, the balance check or the size check.
    function _overCapBuy(string memory salt, bytes memory blob) internal view returns (Intent memory) {
        uint256 amount = uint256(VAULT.mandate().perTradeCapUsd) + 1;
        return _intent(salt, Action.BUY, VAULT.tokens()[0], amount, address(0), blob);
    }

    /// What the vault must answer to a payment of EXPENSE to the allowlisted, funded payee: OK, unless the vault is
    /// paused or the payment does not fit under the per-trade cap and what is left of the daily cap.
    function _expenseReason() internal view returns (Reason) {
        if (VAULT.paused()) return Reason.VAULT_PAUSED;
        uint256 spent = VAULT.spentOnDay(VAULT.today());
        if (EXPENSE > VAULT.mandate().perTradeCapUsd || spent + EXPENSE > VAULT.mandate().dailyCapUsd) {
            return Reason.SIZE_LIMIT;
        }
        return Reason.OK;
    }
}
