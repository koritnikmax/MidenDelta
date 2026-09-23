// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {MidenDeltaVault} from "../src/MidenDeltaVault.sol";
import {SimulatedStrategy} from "../src/SimulatedStrategy.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IStrategy} from "../src/interfaces/IStrategy.sol";

/// forge script script/Deploy.s.sol --rpc-url hyperevm_testnet --broadcast --private-key $PK
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        vm.startBroadcast();
        MockUSDC usdc = new MockUSDC(deployer);
        MidenDeltaVault vault = new MidenDeltaVault(usdc, deployer, deployer);
        SimulatedStrategy strat = new SimulatedStrategy(usdc, address(vault), deployer);
        usdc.grantRole(usdc.MINTER_ROLE(), address(strat));
        vault.setStrategy(IStrategy(address(strat)));
        vm.stopBroadcast();

        console2.log("MockUSDC          ", address(usdc));
        console2.log("MidenDeltaVault   ", address(vault));
        console2.log("SimulatedStrategy ", address(strat));
        string memory json = string.concat(
            '{"chainId":998,"usdc":"', vm.toString(address(usdc)),
            '","vault":"', vm.toString(address(vault)),
            '","strategy":"', vm.toString(address(strat)),
            '","deployer":"', vm.toString(deployer),
            '","block":', vm.toString(block.number), "}"
        );
        vm.writeFile("deployments/hyperevm-testnet.json", json);
    }
}
