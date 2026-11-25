// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MaatInbox} from "../src/MaatInbox.sol";
import {DeployMaatInbox} from "../script/DeployMaatInbox.s.sol";

contract MaatInboxTest is Test {
    /// The ERC-8021 schema-0 suffix of the made-up code "bc_a1b2c3d4": the test vector in agent/test/builderCode.test.ts.
    bytes internal constant SUFFIX = hex"62635f61316232633364340b0080218021802180218021802180218021";

    MaatInbox internal inbox;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        inbox = new MaatInbox();
    }

    /// `n` bytes of ASCII letters.
    function _text(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) {
            b[i] = bytes1(uint8(0x61 + (i % 26)));
        }
        return string(b);
    }

    function _expectBrief(uint256 id, address from, string memory text) internal {
        vm.expectEmit(true, true, true, true, address(inbox));
        emit MaatInbox.Brief(id, from, text);
    }

    // ---- length bounds ----

    function test_maxBytesIs280() public view {
        assertEq(inbox.MAX_BYTES(), 280);
    }

    function test_emptyReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MaatInbox.BadLength.selector, 0));
        inbox.brief("");
        assertEq(inbox.lastId(), 0);
    }

    function test_281BytesReverts() public {
        string memory t = _text(281);
        vm.expectRevert(abi.encodeWithSelector(MaatInbox.BadLength.selector, 281));
        inbox.brief(t);
    }

    function test_1BytePasses() public {
        _expectBrief(1, alice, "x");
        vm.prank(alice);
        assertEq(inbox.brief("x"), 1);
        assertEq(inbox.lastId(), 1);
    }

    function test_280BytesPasses() public {
        string memory t = _text(280);
        _expectBrief(1, alice, t);
        vm.prank(alice);
        assertEq(inbox.brief(t), 1);
    }

    /// The limit is in bytes: U+00E9 is 2 bytes in UTF-8 (0xc3a9), so 140 of them fit and 141 do not.
    function test_limitCountsBytesNotCharacters() public {
        string memory fits;
        for (uint256 i; i < 140; ++i) {
            fits = string.concat(fits, string(hex"c3a9"));
        }
        assertEq(inbox.brief(fits), 1);

        string memory over = string.concat(fits, string(hex"c3a9"));
        vm.expectRevert(abi.encodeWithSelector(MaatInbox.BadLength.selector, 282));
        inbox.brief(over);
    }

    /// Any bytes in range pass and come back unchanged in the log, valid UTF-8 or not.
    function testFuzz_inBoundsPassesUnchanged(bytes memory raw, address sender) public {
        if (raw.length == 0) raw = hex"ff";
        if (raw.length > 280) {
            assembly ("memory-safe") {
                mstore(raw, 280)
            }
        }
        string memory t = string(raw);
        _expectBrief(1, sender, t);
        vm.prank(sender);
        assertEq(inbox.brief(t), 1);
    }

    function testFuzz_outOfBoundsReverts(uint256 n) public {
        n = bound(n, 281, 4096);
        string memory t = _text(n);
        vm.expectRevert(abi.encodeWithSelector(MaatInbox.BadLength.selector, n));
        inbox.brief(t);
    }

    // ---- ids ----

    function test_idsIncreaseAcrossSenders() public {
        vm.prank(alice);
        assertEq(inbox.brief("one"), 1);
        vm.prank(bob);
        assertEq(inbox.brief("two"), 2);
        vm.prank(alice);
        assertEq(inbox.brief("three"), 3);
        assertEq(inbox.lastId(), 3);
    }

    /// A revert gives no id: the next brief takes the next number.
    function test_revertedBriefTakesNoId() public {
        inbox.brief("a");
        vm.expectRevert(abi.encodeWithSelector(MaatInbox.BadLength.selector, 0));
        inbox.brief("");
        assertEq(inbox.brief("b"), 2);
    }

    function testFuzz_idsStrictlyIncreaseFromOne(uint8 count, uint256 seed) public {
        uint256 n = bound(count, 1, 64);
        for (uint256 i; i < n; ++i) {
            // a few senders, so the same sender briefs more than once
            address sender = address(uint160(uint256(keccak256(abi.encode(seed, i % 5)))));
            _expectBrief(i + 1, sender, "brief");
            vm.prank(sender);
            assertEq(inbox.brief("brief"), i + 1);
        }
        assertEq(inbox.lastId(), n);
    }

    // ---- no ether ----

    function testFuzz_etherToBriefReverts(uint256 value) public {
        value = bound(value, 1, 1e30);
        vm.deal(alice, value);
        vm.prank(alice);
        (bool ok,) = address(inbox).call{value: value}(abi.encodeCall(MaatInbox.brief, ("hi")));
        assertFalse(ok);
        assertEq(address(inbox).balance, 0);
        assertEq(inbox.lastId(), 0);
    }

    function testFuzz_etherToTheAddressReverts(uint256 value, bytes memory data) public {
        value = bound(value, 1, 1e30);
        // any call that is not brief(string), with or without data
        if (data.length >= 4) vm.assume(bytes4(data) != MaatInbox.brief.selector);
        vm.deal(alice, value);
        vm.prank(alice);
        (bool ok,) = address(inbox).call{value: value}(data);
        assertFalse(ok);
        assertEq(address(inbox).balance, 0);
    }

    function test_plainTransferReverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = payable(address(inbox)).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(inbox).balance, 0);
    }

    // ---- trailing calldata ----

    function test_builderCodeSuffixAccepted() public {
        bytes memory data = abi.encodePacked(abi.encodeCall(MaatInbox.brief, ("buy NVDAc")), SUFFIX);
        _expectBrief(1, alice, "buy NVDAc");
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(inbox).call(data);
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 1);
    }

    function testFuzz_trailingBytesAccepted(bytes memory tail) public {
        string memory t = _text(280);
        bytes memory data = abi.encodePacked(abi.encodeCall(MaatInbox.brief, (t)), tail);
        _expectBrief(1, alice, t);
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(inbox).call(data);
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 1);
    }

    // ---- storage ----

    function test_onlyTheCounterIsWritten() public {
        vm.record();
        inbox.brief(_text(280));
        (, bytes32[] memory writes) = vm.accesses(address(inbox));
        assertEq(writes.length, 1);
        assertEq(writes[0], bytes32(0));
        assertEq(vm.load(address(inbox), bytes32(0)), bytes32(uint256(1)));
    }

    // ---- deploy script ----

    function test_deployFromTheGivenDeployer() public {
        address deployer = makeAddr("inboxDeployer");
        vm.setNonce(deployer, 9);
        MaatInbox d = new DeployMaatInbox().deploy(deployer);
        assertEq(address(d), vm.computeCreateAddress(deployer, 9));
        assertEq(d.lastId(), 0);
        assertEq(address(d).balance, 0);
    }
}
