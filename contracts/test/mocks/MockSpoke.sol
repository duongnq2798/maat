// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAaveV4Spoke} from "../../src/interfaces/IAaveV4.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Minimal Aave V4 spoke that is also its own oracle and (unless overridden per reserve) its own hub,
/// so it holds every token. Health factor uses Aave's units: value 1e26 = 1 USD, debt as value x RAY.
contract MockSpoke {
    uint256 internal constant RAY = 1e27;

    struct R {
        address underlying;
        address hub;
        uint8 decimals;
        uint256 price; // 8 decimals
        uint16 cfBps;
    }

    mapping(uint256 => R) public reserves;
    uint256[] internal _ids;
    uint256 public usdcReserveId;
    mapping(uint256 => mapping(address => uint256)) public supplied;
    mapping(uint256 => mapping(address => bool)) public usingAsCollateral;
    mapping(address => uint256) public owed;
    uint256 public setCollateralCalls;

    error HealthFactorBelowThreshold();

    function addReserve(uint256 id, address underlying, uint8 decimals_, uint256 price8, uint16 cfBps) external {
        reserves[id] = R(underlying, address(this), decimals_, price8, cfBps);
        _ids.push(id);
    }

    function setUsdcReserve(uint256 id) external {
        usdcReserveId = id;
    }

    function setHub(uint256 id, address hub_) external {
        reserves[id].hub = hub_;
    }

    function accrue(address user, uint256 interest) external {
        owed[user] += interest;
    }

    // ---------------------------------------------------------------- oracle

    function ORACLE() external view returns (address) {
        return address(this);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function getReservePrice(uint256 id) external view returns (uint256) {
        return reserves[id].price;
    }

    // ---------------------------------------------------------------- spoke

    function getReserve(uint256 id) external view returns (IAaveV4Spoke.Reserve memory r) {
        r.underlying = reserves[id].underlying;
        r.hub = reserves[id].hub;
        r.assetId = uint16(id);
        r.decimals = reserves[id].decimals;
    }

    function supply(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        IERC20Minimal(reserves[id].underlying).transferFrom(msg.sender, address(this), amount);
        supplied[id][onBehalfOf] += amount;
        return (amount, amount);
    }

    function setUsingAsCollateral(uint256 id, bool using_, address onBehalfOf) external {
        usingAsCollateral[id][onBehalfOf] = using_;
        ++setCollateralCalls;
    }

    function withdraw(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        uint256 s = supplied[id][onBehalfOf];
        if (amount > s) amount = s;
        supplied[id][onBehalfOf] = s - amount;
        _requireSolvent(onBehalfOf);
        IERC20Minimal(reserves[id].underlying).transfer(msg.sender, amount);
        return (amount, amount);
    }

    function borrow(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        owed[onBehalfOf] += amount;
        _requireSolvent(onBehalfOf);
        IERC20Minimal(reserves[id].underlying).transfer(msg.sender, amount);
        return (amount, amount);
    }

    function repay(uint256 id, uint256 amount, address onBehalfOf) external returns (uint256, uint256) {
        uint256 pull = amount < owed[onBehalfOf] ? amount : owed[onBehalfOf];
        IERC20Minimal(reserves[id].underlying).transferFrom(msg.sender, address(this), pull);
        owed[onBehalfOf] -= pull;
        return (pull, pull);
    }

    function getUserReserveStatus(uint256 id, address user) external view returns (bool, bool) {
        return (usingAsCollateral[id][user], id == usdcReserveId && owed[user] != 0);
    }

    function getUserSuppliedAssets(uint256 id, address user) external view returns (uint256) {
        return supplied[id][user];
    }

    function getUserTotalDebt(uint256 id, address user) external view returns (uint256) {
        return id == usdcReserveId ? owed[user] : 0;
    }

    function getUserAccountData(address user) public view returns (IAaveV4Spoke.UserAccountData memory d) {
        uint256 weighted;
        for (uint256 i; i < _ids.length; ++i) {
            uint256 id = _ids[i];
            if (id == usdcReserveId || !usingAsCollateral[id][user]) continue;
            R memory r = reserves[id];
            uint256 v = supplied[id][user] * r.price * 10 ** (26 - uint256(r.decimals) - 8);
            if (v == 0) continue;
            d.totalCollateralValue += v;
            weighted += v * r.cfBps;
            ++d.activeCollateralCount;
        }
        if (d.totalCollateralValue != 0) d.avgCollateralFactor = weighted * 1e14 / d.totalCollateralValue;
        R memory u = reserves[usdcReserveId];
        uint256 debtValue = owed[user] * u.price * 10 ** (26 - uint256(u.decimals) - 8);
        d.totalDebtValueRay = debtValue * RAY;
        d.borrowCount = owed[user] == 0 ? 0 : 1;
        d.healthFactor =
            debtValue == 0 ? type(uint256).max : d.totalCollateralValue * d.avgCollateralFactor / debtValue;
    }

    function _requireSolvent(address user) internal view {
        if (getUserAccountData(user).healthFactor < 1e18) revert HealthFactorBelowThreshold();
    }
}
