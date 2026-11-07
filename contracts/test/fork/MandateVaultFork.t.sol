// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {Action, Reason, SessionMode, Intent, TokenConfig} from "../../src/Types.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract MandateVaultForkTest is Test {
    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal payee = makeAddr("payee");
    MandateVault internal vault;
    uint256 internal nonce;

    function _deploy(uint256 blockNumber, SessionMode mode) internal {
        vm.createSelectFork("base", blockNumber);
        MarketCalendar calendar = new MarketCalendar(owner);
        AerodromeSwapAdapter adapter = new AerodromeSwapAdapter();
        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(mode, address(calendar), address(adapter), address(0)),
            toks,
            cfgs,
            payees
        );
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
            rationaleHash: keccak256("fork")
        });
        vm.prank(executor, executor);
        (, r) = vault.execute(i);
    }

    function test_buyAndSellNvdacInSession() public {
        _deploy(A.BLOCK_SESSION, SessionMode.REGULAR);
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 20e6, address(0))), uint8(Reason.OK));
        uint256 bal = IB20Asset(A.NVDAC).balanceOf(address(vault));
        assertApproxEqRel(bal, 10_714_000, 0.02e18); // $20 / $186.67

        assertEq(uint8(_exec(Action.SELL, A.NVDAC, bal, address(0))), uint8(Reason.OK));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(vault)), 0);
        assertApproxEqRel(IERC20Minimal(A.USDC).balanceOf(address(vault)), 200e6, 0.01e18);
    }

    function test_basketBuysInSession() public {
        _deploy(A.BLOCK_SESSION, SessionMode.REGULAR);
        assertEq(uint8(_exec(Action.BUY, A.GOOGLC, 20e6, address(0))), uint8(Reason.OK));
        assertEq(uint8(_exec(Action.BUY, A.AAPLC, 20e6, address(0))), uint8(Reason.OK));
        assertGt(IB20Asset(A.GOOGLC).balanceOf(address(vault)), 0);
        assertGt(IB20Asset(A.AAPLC).balanceOf(address(vault)), 0);
    }

    function test_weekendBuyIsRefusedInBothModes() public {
        _deploy(A.BLOCK_WEEKEND, SessionMode.REGULAR);
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 20e6, address(0))), uint8(Reason.MARKET_CLOSED));
        _deploy(A.BLOCK_WEEKEND, SessionMode.FEED_24_5);
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 20e6, address(0))), uint8(Reason.MARKET_CLOSED));
        assertEq(IERC20Minimal(A.USDC).balanceOf(address(vault)), 200e6);
    }

    function test_compromisedExecutorIsBounded() public {
        _deploy(A.BLOCK_SESSION, SessionMode.REGULAR);
        address attacker = makeAddr("attacker");
        assertEq(uint8(_exec(Action.PAY_EXPENSE, A.USDC, 100e6, attacker)), uint8(Reason.PAYEE_NOT_ALLOWED));
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 60e6, address(0))), uint8(Reason.SIZE_LIMIT));
        vm.prank(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.withdraw(A.USDC, 1);
        assertEq(IERC20Minimal(A.USDC).balanceOf(attacker), 0);
        assertEq(IERC20Minimal(A.USDC).balanceOf(address(vault)), 200e6);
    }
}
