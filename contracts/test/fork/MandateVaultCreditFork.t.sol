// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {Action, Reason, SessionMode, Intent, TokenConfig} from "../../src/Types.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract MandateVaultCreditForkTest is Test {
    uint256 internal constant SAT_1800_UTC = 1794074400; // Sat 2026-11-07 18:00 UTC, two days after BLOCK_SESSION

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal payee = makeAddr("payee");
    MandateVault internal vault;
    AaveV4CreditAdapter internal credit;
    uint256 internal nonce;

    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        MarketCalendar calendar = new MarketCalendar(owner);
        AerodromeSwapAdapter swap = new AerodromeSwapAdapter();
        (address[] memory ctoks, uint256[] memory ids) = MaatConfig.creditReserves();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        credit = new AaveV4CreditAdapter(predicted, A.USDC, A.AAVE_MAG7_SPOKE, A.AAVE_RESERVE_USDC, ctoks, ids);
        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(swap), address(credit)),
            toks,
            cfgs,
            payees
        );
        assertEq(address(vault), predicted);
        deal(A.USDC, address(vault), 200e6);
        vault.notifyRevenue();
    }

    function _exec(Action a, address token, uint256 amount, address to) internal returns (Reason r) {
        Intent memory i = Intent({
            id: keccak256(abi.encode(++nonce)),
            action: a,
            token: token,
            amount: amount,
            minOut: 0,
            payee: to,
            rationaleHash: keccak256("fork-credit")
        });
        vm.prank(executor, executor);
        (, r) = vault.execute(i);
    }

    function _ok(Action a, address token, uint256 amount, address to) internal {
        assertEq(uint8(_exec(a, token, amount, to)), uint8(Reason.OK));
    }

    function _usdc(address a) internal view returns (uint256) {
        return IERC20Minimal(A.USDC).balanceOf(a);
    }

    /// @dev BUY $20 NVDAc, supply all of it, return the raw amount supplied.
    function _buyAndSupply() internal returns (uint256 stock) {
        _ok(Action.BUY, A.NVDAC, 20e6, address(0));
        stock = IB20Asset(A.NVDAC).balanceOf(address(vault));
        _ok(Action.SUPPLY, A.NVDAC, stock, address(0));
        assertEq(credit.suppliedOf(A.NVDAC), stock);
    }

    function test_creditLoopInSession() public {
        uint256 stock = _buyAndSupply();

        // $19.98 x 70% / $10 = HF 1.40 < 1.5; $5 gives HF ~2.80
        assertEq(uint8(_exec(Action.BORROW, A.USDC, 10e6, address(0))), uint8(Reason.HEALTH_FACTOR_LOW));
        _ok(Action.BORROW, A.USDC, 5e6, address(0));
        assertEq(vault.notifyRevenue(), 0); // borrowed USDC is not revenue

        _ok(Action.PAY_EXPENSE, A.USDC, 3e6, payee);
        assertEq(_usdc(payee), 3e6);

        _ok(Action.REPAY, A.USDC, 10e6, address(0)); // more than owed: only the debt is pulled
        assertEq(credit.debt(), 0);
        _ok(Action.WITHDRAW_COLLATERAL, A.NVDAC, stock, address(0));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(vault)), stock);
        assertFalse(credit.hasPosition());
        assertEq(_usdc(address(credit)), 0);
        // 200 - 20 buy + 5 borrow - 3 expense - 5 repay (+ wei of interest); the NVDAc is still held
        assertApproxEqAbs(_usdc(address(vault)), 177e6, 10);
    }

    function test_weekendBlocksBorrowButAllowsRepayAndWithdraw() public {
        uint256 stock = _buyAndSupply();
        _ok(Action.BORROW, A.USDC, 5e6, address(0));

        vm.warp(SAT_1800_UTC);
        assertEq(uint8(_exec(Action.BORROW, A.USDC, 1e6, address(0))), uint8(Reason.MARKET_CLOSED));
        // collateral against open debt stays put while the market is closed
        assertEq(uint8(_exec(Action.WITHDRAW_COLLATERAL, A.NVDAC, stock, address(0))), uint8(Reason.MARKET_CLOSED));
        _ok(Action.REPAY, A.USDC, 10e6, address(0));
        assertEq(credit.debt(), 0);
        _ok(Action.WITHDRAW_COLLATERAL, A.NVDAC, stock, address(0));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(vault)), stock);
    }
}
