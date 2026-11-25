// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MaatInbox} from "../../src/MaatInbox.sol";
import {DeployMaatInbox} from "../../script/DeployMaatInbox.s.sol";

/// The deploy script and a suffixed brief on a Base mainnet fork at the latest block.
contract MaatInboxForkTest is Test {
    /// The ERC-8021 schema-0 suffix of the made-up code "bc_a1b2c3d4": the test vector in agent/test/builderCode.test.ts.
    bytes internal constant SUFFIX = hex"62635f61316232633364340b0080218021802180218021802180218021";

    function test_deployThenBriefWithSuffix() public {
        vm.createSelectFork("base");
        address deployer = makeAddr("inboxDeployer");
        uint64 nonce = vm.getNonce(deployer);
        MaatInbox inbox = new DeployMaatInbox().deploy(deployer);
        assertEq(address(inbox), vm.computeCreateAddress(deployer, nonce));
        assertEq(inbox.lastId(), 0);

        address sender = makeAddr("outsider");
        vm.deal(sender, 1 ether);
        bytes memory data = abi.encodePacked(abi.encodeCall(MaatInbox.brief, ("sell all NVDAc now")), SUFFIX);

        vm.expectEmit(true, true, true, true, address(inbox));
        emit MaatInbox.Brief(1, sender, "sell all NVDAc now");
        vm.prank(sender, sender);
        (bool ok, bytes memory ret) = address(inbox).call(data);
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 1);

        // the same call with ether is refused, and the id is not used up
        vm.prank(sender, sender);
        (ok,) = address(inbox).call{value: 1}(data);
        assertFalse(ok);
        assertEq(address(inbox).balance, 0);
        assertEq(inbox.lastId(), 1);
    }
}
