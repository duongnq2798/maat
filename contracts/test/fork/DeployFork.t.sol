// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {SessionMode} from "../../src/Types.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

contract DeployForkTest is Test {
    function test_deployWiresEverything() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        address owner = makeAddr("owner");
        address executor = makeAddr("executor");
        address payee = makeAddr("payee");
        vm.setEnv("MAAT_OWNER", vm.toString(owner));
        vm.setEnv("MAAT_EXECUTOR", vm.toString(executor));
        vm.setEnv("MAAT_EXPENSE_PAYEE", vm.toString(payee));

        (MarketCalendar calendar, AerodromeSwapAdapter adapter, MandateVault vault) = new Deploy().run();

        assertEq(vault.owner(), owner);
        assertEq(vault.executor(), executor);
        assertEq(vault.usdc(), A.USDC);
        assertEq(vault.policyRegistry(), A.POLICY_REGISTRY);
        assertTrue(vault.allowedPayee(payee));
        assertEq(vault.tokens().length, 3);
        assertEq(vault.mandate().calendar, address(calendar));
        assertEq(vault.mandate().swapAdapter, address(adapter));
        assertEq(uint8(vault.mandate().sessionMode), uint8(SessionMode.REGULAR));
        assertEq(calendar.owner(), owner);
    }
}
