import "../css/bootstrap.min.css";
import "../css/bootstrap-theme.min.css";
import "../css/custom.css";
import "jquery";
import "./bootstrap.min.js";
import { default as Web3} from 'web3';
import { default as contract } from 'truffle-contract'
import tokendrop_artifacts from '../../build/contracts/TokenDrop.json'
import erc20_artifacts from '../../build/contracts/IERC20Token.json'

var bip39 = require("bip39");
var Promise = require("bluebird");
var ENS = require("ethereum-ens");
var EthereumTx = require("ethereumjs-tx");
var hdkey = require('ethereumjs-wallet/hdkey')
var _ = require('underscore');
const ethUtil = require('ethereumjs-util')
var redeem_template = require("../redeem.handlebars");
var tokenlist_template = require("../tokenlist.handlebars");

require('events').EventEmitter.defaultMaxListeners = 100;

var TokenDrop = contract(tokendrop_artifacts);
var Token = contract(erc20_artifacts);

var tokens = require("./tokens.json");

var addrRegex = /0x[0-9a-fA-F]{40}/;

function signAndSendTransaction(wallet, txParams) {
    return Promise.promisify(web3.version.getNetwork)().then(function(chainId) {
        //txParams.chainId = chainId;
        return web3.eth.getTransactionCountAsync(wallet.getAddressString()).then(function(nonce) {
            txParams.nonce = nonce;
            const tx = new EthereumTx(txParams);
            tx.sign(wallet.getPrivateKey());
            var txdata = tx.serialize();
            return web3.eth.sendRawTransactionAsync('0x' + txdata.toString('hex'));
        });
    });
}

function signDrop(wallet, recipient, dropId) {
    return TokenDrop.deployed().then(function(td) {
        return td.computeSignaturehash(recipient, dropId).then(function(hash) {
            var sig = ethUtil.ecsign(ethUtil.toBuffer(hash), wallet.getPrivateKey());
            return {
                v: sig.v,
                r: ethUtil.bufferToHex(sig.r),
                s: ethUtil.bufferToHex(sig.s)
            }
        });
    });
}

function getEtherSweeper(address) {
    return web3.eth.getBalanceAsync(address).then(function(balance) {
        if(balance > 0) {
            return [{
                balance: balance / 1e18,
                name: 'ether',
                type: 'ether',
                sweep: function(wallet, targetAddress) {
                    return web3.eth.getGasPriceAsync().then(function(gasPrice) {
                        var amount = balance.sub(gasPrice.times(23300));
                        return signAndSendTransaction(wallet, {
                            to: targetAddress,
                            gasPrice: '0x' + gasPrice.toString(16),
                            gas: 23300,
                            value: '0x' + amount.toString(16),
                        });
                    });
                }
            }];
        } else {
            return [];
        }
    })
}

function getTokenSweepers(address) {
    return Promise.map(tokens, function(token) {
        return token.contract.balanceOf(address);
    }).then(function(balances) {
        var sweepers = [];
        for(var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            var balance = balances[i];
            if(balance > 0) {
                sweepers.push({
                    balance: balance / Math.pow(10, token.decimal),
                    name: token.symbol,
                    type: 'token',
                    sweep: function(wallet, targetAddress) {
                        return web3.eth.getGasPriceAsync().then(function(gasPrice) {
                            return token.contract.transfer.estimateGas(targetAddress, balance, {from: address}).then(function(gasLimit) {
                                return signAndSendTransaction(wallet, {
                                    to: token.address,
                                    gasPrice: '0x' + gasPrice.toNumber(16),
                                    gas: gasLimit + 20000,
                                    value: "0x00",
                                    data: token.contract.transfer.request(targetAddress, balance).params[0].data
                                });
                            });
                        });
                    }
                });
            }
        }
        return sweepers;
    });
}

function getTokendropSweepers(address) {
    return tokenDrop.dropCount(address).then(function(count) {
        return Promise.map(_.range(count), function(idx) {
            return tokenDrop.getDrop(address, idx).then(function(dropinfo) {
                var dropId = dropinfo[1];
                var quantity = dropinfo[2];
                return Token.at(dropinfo[0]).then(function(token) {
                    return Promise.all([
                        token.symbol(),
                        token.decimals()
                    ]).then(function(tokeninfo) {
                        return {
                            balance: quantity / Math.pow(10, tokeninfo[1]),
                            name: tokeninfo[0],
                            type: 'tokendrop',
                            tokendrop: true,
                            sweep: function(wallet, targetAddress) {
                                return web3.eth.getGasPriceAsync().then(function(gasPrice) {
                                    return signDrop(wallet, targetAddress, dropId).then(function(sig) {
                                        return tokenDrop.redeemFor.estimateGas(targetAddress, dropId, idx, sig.v, sig.r, sig.s).then(function(gasLimit) {
                                            return tokenDrop.redeemFor(targetAddress, dropId, idx, sig.v, sig.r, sig.s, {
                                                from: web3.eth.accounts[0],
                                                gasPrice: gasPrice,
                                                gasLimit: gasLimit
                                            });
                                        });
                                    });
                                });
                            }
                        };
                    });
                });
            });
        });
    });
}

var sweeperFactories = [getTokendropSweepers, getTokenSweepers, getEtherSweeper];

window.App = {
    start: function() {
        TokenDrop.setProvider(web3.currentProvider);
        Token.setProvider(web3.currentProvider);
        TokenDrop.deployed().then(function(instance) {
            window.tokenDrop = instance;
        });
        window.ens = new ENS(web3);

        _.each(_.values(tokens), function(token) {
            token.contract = Token.at(token.address);
        });

        // --------------------------------------------------------
        //  Redeem textarea
        // --------------------------------------------------------
        var lastMnemonic = "";
        $("#mnemonic").keyup(function() {
            var mnemonic = $("#mnemonic").val();
            if(mnemonic === lastMnemonic) return;
            lastMnemonic = mnemonic;

            if(!bip39.validateMnemonic(mnemonic)) {
                $("#wallet").html("");
                return;
            }

            var seed = bip39.mnemonicToSeed(mnemonic);
            var wallet = hdkey.fromMasterSeed(seed).derivePath("m/44'/60'/0'/0/0").getWallet();
            App.buildRedemptionForm(wallet);
        });

        // --------------------------------------------------------
        // Token list
        // --------------------------------------------------------
        App.buildTokenList();
    },
    buildTokenList: function() {
        if(web3.eth.accounts.length == 0) {
            $("#tokenlist").html(tokenlist_template({}));
        }

        var address = web3.eth.accounts[0];
        Promise.map(tokens, function(token) {
            return token.contract.balanceOf(address);
        }).then(function(balances) {
            var tokenBalances = [];
            for(var i = 0; i < tokens.length; i++) {
                if(balances[i] > 0) {
                    var token = _.clone(tokens[i]);
                    token.balance = balances[i] / Math.pow(10, token.decimal);
                    tokenBalances.push(token);
                }
            }

            var rendered = tokenlist_template({
                tokens: tokenBalances,
            });
            $("#tokenlist").html(rendered);

            function getToken() {
                var i = $(".tokenidx:checked").val();
                if(i !== "" && i !== undefined) {
                    return Promise.resolve(tokenBalances[i]);
                }
                
                var tokenAddr = $("#tokeninput").val();
                if(!addrRegex.test(tokenAddr)) {
                    return Promise.reject(new Error("Invalid token address"));
                }

                var p;
                if(tokenAddr !== undefined && tokenAddr.indexOf(".") != -1) {
                    // ENS name
                    p = ens.resolver(tokenAddr).addr().then();
                } else {
                    p = Promise.resolve(tokenAddr);
                }

                return p.then(function(addr) {
                    var contract = Promise.promisifyAll(Token.at(addr));
                    Promise.all([
                        contract.symbol(),
                        contract.decimals()
                    ]).then(function(results) {
                        return {
                            symbol: results[0],
                            decimal: results[1],
                            contract: contract
                        };                        
                    });
                });
            }

            function getDropAddresses() {
                return _.filter($("#addresses").val().split(/[ \n]/), function(addr) { return addr.length > 0; });
            }

            function updateButton() {
                var enabled = true;
                var addresses = getDropAddresses();
                if(addresses.length == 0 || !_.every(getDropAddresses(), function(addr) { return addrRegex.test(addr); })) {
                    enabled = false;
                }

                try {
                    var numTokens = parseFloat($("#numtokens").val())
                    if(numTokens == 0.0 || Number.isNaN(numTokens))
                        enabled = false;
                } catch(e) {
                    enabled = false;
                }

                if(enabled) {
                    getToken().then(function(token) {
                        return token.contract.balanceOf(address).then(function(balance) {
                            if(balance / Math.pow(10, token.decimal) < parseFloat($("#numtokens").val()) * addresses.length) {
                                enabled = false;
                            }
                        });
                    }).catch(function(err) {
                        console.log(err);
                        enabled = false;
                    }).then(function() {
                        if(enabled) {
                            $("#createbutton").removeAttr("disabled");
                        } else {
                            $("#createbutton").attr("disabled", "disabled");
                        }
                        $("#createbutton").html("Create (" + (1 + Math.ceil(addresses.length / 100)) + " transactions)");
                    });
                } else {
                    $("#createbutton").attr("disabled", "disabled");
                }
            }

            $(".tokenidx").change(updateButton);
            $("#tokenaddrinput").focus(function() { $("#manualtokenaddr").prop("checked", true); });
            $("#addresses, #numtokens").keyup(updateButton);

            $("#createbutton").click(function() {
                var dropAddresses = getDropAddresses();
                var numTokens = web3.toBigNumber($("#numtokens").val()).times(web3.toBigNumber(10).toPower(token.decimal)).truncated();
                getToken().then(function(token) {
                    TokenDrop.deployed().then(function(td) {
                        token.contract.approve(td.address, dropAddresses.length * numTokens, {from: web3.eth.accounts[0]}).then(function(result) {
                            console.log(result);
                            _.each(_.groupBy(dropAddresses, function(x, i) { return Math.floor(i / 100); }), function(batch) {
                                td.deposit(token.address, batch, numTokens, {from: web3.eth.accounts[0]}).then(function(result) {
                                    console.log(result);
                                });
                            });
                        });
                    });
                });
            });
        });
    },
    getTargetAddr: function() {
        var targetAddr = $(".targetradio:checked").val();
        if(targetAddr === undefined) {
            return Promise.resolve('0x0000000000000000000000000000000000000000');
        }

        if(targetAddr !== "") {
            return Promise.resolve(targetAddr);
        }

        var addrPromise;
        targetAddr = $("#targetinput").val();
        if(targetAddr !== undefined && targetAddr.indexOf(".") != -1) {
            // ENS name
            return ens.resolver(targetAddr).addr();
        } else {
            return Promise.resolve(targetAddr || '0x0000000000000000000000000000000000000000');
        }
    },
    updateSweepButton: function() {
        var balanceType = $(".balanceradio:checked").val();
        if(balanceType === undefined) {
            $("#sweepbutton").attr("disabled", "disabled");
            $("#dropwarning").css("visibility", "hidden");                
            return;
        }

        var sweeper = App.sweepers[parseInt(balanceType)];
        if(sweeper.tokendrop && web3.eth.accounts.length == 0) {
            $("#sweepbutton").attr("disabled", "disabled");
            $("#dropwarning").css("visibility", "visible");
        } else {
            $("#dropwarning").css("visibility", "hidden");                
        }

        App.getTargetAddr().then(function(addr) {
            if(addr !== '0x0000000000000000000000000000000000000000' && addrRegex.test(addr)) {
                $("#sweepbutton").removeAttr("disabled")
            } else {
                $("#sweepbutton").attr("disabled", "disabled");
            }
        }).catch(function() {
            $("#sweepbutton").attr("disabled", "disabled");                
        });
    },
    sweep: function() {
        if($("#sweepbutton").attr("disabled") == "disabled") return;

        var sweeper = App.sweepers[parseInt($(".balanceradio:checked").val())];
        App.getTargetAddr().then(function(targetAddress) {
            var sent = sweeper.sweep(App.wallet, targetAddress);
            sent.then(function(receipt) {
                App.buildRedemptionForm(App.wallet);
                $("#txid").html(receipt.tx);
                $("#txidlink").attr("href", "https://etherscan.io/tx/" + receipt.tx);
                $("#txSentModal").modal({keyboard: true});
            });
        });
    },
    buildRedemptionForm: function(wallet) {
        App.wallet = wallet;
        App.address = wallet.getAddressString();
        Promise.all(_.map(sweeperFactories, function(factory) { return factory(App.address); }))
        .then(function(results) {
            App.sweepers = _.flatten(results, true);

            var targets = [];
            for(var i = 0; i < web3.eth.accounts.length; i++) {
                targets.push({address: web3.eth.accounts[i]});
            }

            var rendered = redeem_template({
                address: App.address,
                sweepers: App.sweepers,
                hasBalances: App.sweepers.length > 0,
                targets: targets,
            });
            $("#wallet").html(rendered);

            $(".balanceradio,.targetradio").change(App.updateSweepButton);
            $("#targetinput").focus(function() { $("#manualtarget").prop("checked", true); });
            $("#targetinput").keyup(App.updateSweepButton);
            $("#sweepbutton").click(App.sweep);
        });
    }
}

$(document).ready(function() {
    if(typeof web3 === 'undefined') {
        var providerURL = 'https://mainnet.infura.io/Rg6BrBl8vIqJBc7AlL9h';
        window.web3 = new Web3(new Web3.providers.HttpProvider(providerURL));
    } else {
        window.web3 = new Web3(web3.currentProvider);
    }
    window.web3.eth = Promise.promisifyAll(window.web3.eth);
    window.web3.eth.defaultBlock = 'pending';

    App.start();
});
