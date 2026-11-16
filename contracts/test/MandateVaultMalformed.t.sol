// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {Action, Intent} from "../src/Types.sol";
import {IERC20Minimal} from "../src/interfaces/IExternal.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockB20} from "./mocks/MockB20.sol";

/// @notice "execute reverts only with NotExecutor or IntentAlreadyUsed" holds while every dependency follows its
/// ABI. try/catch catches a revert inside the call, not a revert while decoding what the call returned, and a plain
/// read has no try at all. These tests show execute reverting, with nothing recorded, when a dependency breaks that.
contract MandateVaultMalformedTest is VaultFixture {
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

    function test_revertingUsdcBalanceOfRevertsExecute() public {
        // a plain read, outside any try: the revert bubbles up unchanged
        vm.mockCallRevert(
            address(usdc), abi.encodeWithSelector(IERC20Minimal.balanceOf.selector), "balanceOf"
        );
        _assertExecuteReverts(_intent(Action.BUY, 20e6), "balanceOf");
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
