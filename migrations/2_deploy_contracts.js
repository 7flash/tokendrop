var ERC20TestToken = artifacts.require("./ERC20TestToken.sol");
var TokenDrop = artifacts.require("./TokenDrop.sol");

// rookie people despair fury shrimp kangaroo creek voice priority lady pigeon educate
var testAddress = '0xeB96E6C560ed480901a10196E06Ea6f9B458e19C';

module.exports = function(deployer, network, accounts) {
    deployer.deploy(TokenDrop).then(function() {
        if(network == "development") {
            return deployer.deploy(ERC20TestToken).then(function() {
                return ERC20TestToken.deployed();
            }).then(function(token) {
                return token.issue(1e19, {from: accounts[0]})
                .then(function() {
                    return token.transfer(testAddress, 1e18, {from: accounts[0]});
                }).then(function() {
                    return token.approve(TokenDrop.address, 1e18, {from: accounts[0]});
                }).then(function() {
                    return web3.eth.sendTransaction({from: accounts[0], to: testAddress, value: 1e18});
                }).then(function() {
                    return TokenDrop.deployed();
                }).then(function(td) {
                    return null;
                    //return td.deposit(token.address, [testAddress], 1e18, {from: accounts[0]});
                });
            });
        }
    });
};
