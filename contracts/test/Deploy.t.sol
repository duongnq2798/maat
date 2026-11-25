// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {MandateVault} from "../src/MandateVault.sol";

contract DeployHarness is Deploy {
    function expensePayeesOf(address first, address second) external pure returns (address[] memory) {
        return expensePayees(first, second);
    }

    function optionalAddressOf(string memory name) external view returns (address) {
        return optionalAddress(name);
    }
}

contract DeployTest is VaultFixture {
    DeployHarness internal h = new DeployHarness();
    address internal payee2 = makeAddr("payee2");

    function test_expensePayees_onePayee() public view {
        address[] memory want = new address[](1);
        want[0] = payee;
        assertEq(h.expensePayeesOf(payee, address(0)), want);
    }

    function test_expensePayees_twoPayees() public {
        address[] memory list = h.expensePayeesOf(payee, payee2);
        address[] memory want = new address[](2);
        want[0] = payee;
        want[1] = payee2;
        assertEq(list, want);

        // both are on the allowlist from construction, in this order, with no timelocked change
        MandateVault v = _deployVault(defaultMandate(), list);
        assertEq(v.payees(), want);
        assertTrue(v.allowedPayee(payee));
        assertTrue(v.allowedPayee(payee2));
    }

    function test_expensePayees_secondEqualToFirstReverts() public {
        vm.expectRevert(bytes("MAAT_EXPENSE_PAYEE_2 equals MAAT_EXPENSE_PAYEE"));
        h.expensePayeesOf(payee, payee);
    }

    function test_expensePayees_secondUnsetGivesOnePayee() public view {
        // run() reads MAAT_EXPENSE_PAYEE_2 through optionalAddress. A name no one sets keeps this test off
        // contracts/.env, which forge loads by itself.
        address[] memory list = h.expensePayeesOf(payee, h.optionalAddressOf("MAAT_TEST_UNSET_PAYEE_2"));
        assertEq(list.length, 1);
        assertEq(list[0], payee);
    }
}
