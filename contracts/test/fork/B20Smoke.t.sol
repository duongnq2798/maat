// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IB20Asset, IPolicyRegistry, B20Constants} from "../../src/interfaces/IB20Asset.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

contract B20SmokeForkTest is Test {
    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
    }

    function test_readsB20StateThroughPrecompile() public view {
        IB20Asset t = IB20Asset(A.NVDAC);
        assertEq(t.decimals(), 8);
        assertGe(t.uiMultiplier(), 1e18);
        assertFalse(t.isPaused(B20Constants.FEATURE_TRANSFER));
        uint64 id = t.policyId(B20Constants.TRANSFER_RECEIVER_POLICY);
        assertTrue(id == 0 || IPolicyRegistry(B20Constants.POLICY_REGISTRY).policyExists(id));
    }

    function test_transfersNvdacOnFork() public {
        address holder = A.NVDAC_USDC_POOL;
        vm.prank(holder);
        IB20Asset(A.NVDAC).transfer(address(0xBEEF), 1e8);
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(0xBEEF)), 1e8);
    }
}
