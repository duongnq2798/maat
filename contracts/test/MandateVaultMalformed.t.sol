// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {stdError} from "forge-std/StdError.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {CreditFixture} from "./utils/CreditFixture.sol";
import {Action, Intent} from "../src/Types.sol";
import {ICLPool, IERC20Minimal} from "../src/interfaces/IExternal.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockCreditAdapter} from "./mocks/MockCreditAdapter.sol";

/// @notice "execute reverts only with NotExecutor or IntentAlreadyUsed" is the design, and these tests show the
/// failures of a dependency it does not catch. try/catch catches a revert inside the call, not a revert while
/// decoding what the call returned, a plain read has no try at all, and an error raised in a try's success block
/// is not caught either. Each case reverts execute with nothing recorded.
contract MandateVaultMalformedTest is CreditFixture {
    function test_feedReturningTooLittleDataRevertsExecute() public {
        // latestRoundData declares five return values; two words fail the decoding in PriceLib.readFeed
        vm.mockCall(
            address(feed),
            abi.encodeWithSelector(MockFeed.latestRoundData.selector),
            abi.encode(uint80(1), int256(200e8))
        );
        _assertExecuteReverts(_intent(Action.BUY, 20e6), "");
    }

    function test_tokenReturningTooLittleDataRevertsExecute() public {
        // isPaused declares a bool; empty return data fails the decoding in GuardLib.tokenPaused
        vm.mockCall(address(nvda), abi.encodeWithSelector(MockB20.isPaused.selector), "");
        _assertExecuteReverts(_intent(Action.BUY, 20e6), "");
    }

    function test_adapterViewReturningTooLittleDataRevertsExecute() public {
        // suppliedOf declares a uint256; empty return data fails the decoding in MandateVault._supplied
        vm.mockCall(address(credit), abi.encodeWithSelector(MockCreditAdapter.suppliedOf.selector), "");
        _assertExecuteReverts(_creditIntent(Action.BORROW, address(usdc), 10e6), "");
    }

    function test_revertingUsdcBalanceOfRevertsExecute() public {
        // a plain read, outside any try: the revert bubbles up unchanged
        vm.mockCallRevert(
            address(usdc), abi.encodeWithSelector(IERC20Minimal.balanceOf.selector), "balanceOf"
        );
        _assertExecuteReverts(_intent(Action.BUY, 20e6), "balanceOf");
    }

    function test_revertingStockDecimalsRevertsExecute() public {
        vm.mockCallRevert(address(nvda), abi.encodeWithSelector(IERC20Minimal.decimals.selector), "decimals");
        _assertExecuteReverts(_intent(Action.BUY, 20e6), "decimals");
    }

    function test_revertingPoolToken0RevertsExecute() public {
        // PriceLib.twapPrice reads token0 in the success block of its try around observe
        vm.mockCallRevert(address(pool), abi.encodeWithSelector(ICLPool.token0.selector), "token0");
        _assertExecuteReverts(_intent(Action.BUY, 20e6), "token0");
    }

    function test_poolAnswerTooShortForTheTwapRevertsExecute() public {
        // well-formed, but one observation where the TWAP indexes two: out of bounds in the success block
        vm.mockCall(
            address(pool),
            abi.encodeWithSelector(ICLPool.observe.selector),
            abi.encode(new int56[](1), new uint160[](1))
        );
        _assertExecuteReverts(_intent(Action.BUY, 20e6), stdError.indexOOBError);
    }

    function test_poolTickOutsideTickMathRangeRevertsExecute() public {
        int24 tick = TickMath.MAX_TICK + 1;
        pool.setTick(tick, 1800);
        _assertExecuteReverts(
            _intent(Action.BUY, 20e6), abi.encodeWithSelector(TickMath.InvalidTick.selector, tick)
        );
    }

    /// @dev Reverts with `want` and no Decision: the intent id stays unused, so preview reverts the same way.
    function _assertExecuteReverts(Intent memory i, bytes memory want) internal {
        vm.prank(executor, executor);
        try vault.execute(i) {
            revert("execute did not revert");
        } catch (bytes memory err) {
            assertEq(err, want);
        }
        assertFalse(vault.usedIntent(i.id));
        vm.prank(executor, executor);
        try vault.previewIntent(i) {
            revert("previewIntent did not revert");
        } catch (bytes memory err) {
            assertEq(err, want);
        }
    }
}
