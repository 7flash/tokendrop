var TokenDrop = artifacts.require("./TokenDrop.sol");
var ERC20TestToken = artifacts.require("./ERC20TestToken.sol");
const ethUtil = require('ethereumjs-util')
var Wallet = require('ethereumjs-wallet')

var wallet = Wallet.generate();

contract('TokenDrop', function(accounts) {
  it("should handle deposits", function() {
    return TokenDrop.deployed().then(function(td) {
      return ERC20TestToken.deployed().then(function(token) {
        var startBalance;
        // Issue tokens to accounts[0]
        return token.issue(1e18, {from: accounts[0]}).then(function() {
          return token.balanceOf.call(accounts[0]);
        }).then(function(balance) {
          startBalance = balance;
          // Approve 1e18 tokens for the token drop contract
          return token.approve(td.address, 1e18, {from: accounts[0]});
        }).then(function() {
          // Deposit 1e16 tokens to the wallet address
          return td.deposit(token.address, [wallet.getAddressString(), accounts[3]], 1e16, {from: accounts[0]});
        }).then(function(result) {
          // Check the expected events were emitted
          assert.equal(result.logs.length, 2);
          assert.equal(result.logs[0].args.owner, wallet.getAddressString());
          assert.equal(result.logs[0].args.token, token.address);
          assert.equal(result.logs[0].args.quantity.toNumber(), 1e16);
          assert.equal(result.logs[1].args.owner, accounts[3]);

          // Check token balance of accounts[0]
          return token.balanceOf.call(accounts[0]);
        }).then(function(balance) {
          assert.equal(balance.toNumber(), startBalance - 2e16);

          // Check token balance of token drop account
          return token.balanceOf.call(td.address);
        }).then(function(balance) {
          assert.equal(balance, 2e16);

          // Check number of drops
          return td.dropCount(wallet.getAddressString());
        }).then(function(count) {
          assert.equal(count, 1);

          // Check drop details
          return td.getDrop(wallet.getAddressString(), 0);
        }).then(function(dropinfo) {
          assert.equal(dropinfo[0], token.address);
          assert.equal(dropinfo[1].toNumber(), 0); // dropId
          assert.equal(dropinfo[2].toNumber(), 1e16); // quantity
        });
      });
    });
  });

  function signDrop(sender, recipient, dropId) {
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

  it("should reject invalid signatures", function() {
    return TokenDrop.deployed().then(function(td) {
      return ERC20TestToken.deployed().then(function(token) {
        // Sign a message transferring tokens owned by accounts[1] to accounts[4]
        return signDrop(accounts[1], accounts[4], 0).then(function(sig) {
          // Try and redeem it for accounts[0]
          return td.redeemFor(accounts[0], 0, 0, sig.v, sig.r, sig.s, {from: accounts[0]}).then(function() {
            assert.fail("Expected exception");
          }).catch(function() { });
        });
      });
    });
  });

  it("should redeem tokens using redeemFor()", function() {
    return TokenDrop.deployed().then(function(td) {
      return ERC20TestToken.deployed().then(function(token) {
        // Sign a message transferring tokens owned by the wallet to accounts[4]
        return signDrop(wallet.getAddressString(), accounts[4], 0).then(function(sig) {
          return td.redeemFor(accounts[4], 0, 0, sig.v, sig.r, sig.s, {from: accounts[0]}).then(function() {
            // Check token balance of receiving account
            return token.balanceOf.call(accounts[4]);
          }).then(function(balance) {
            assert.equal(balance.toNumber(), 1e16);
            // Check token balance of token drop account
            return token.balanceOf.call(td.address);
          }).then(function(balance) {
            assert.equal(balance.toNumber(), 1e16);
            // Check the drop has been deleted
            return td.dropCount(wallet.getAddressString());
          }).then(function(count) {
            assert.equal(count.toNumber(), 0);
          });
        });
      });
    });
  });

  it("should allow withdrawing tokens with withdraw()", function() {
    return TokenDrop.deployed().then(function(td) {
      return ERC20TestToken.deployed().then(function(token) {
        return td.withdraw(0, 0, {from: accounts[3]}).then(function() {
          // Check token balance of receiving account
          return token.balanceOf.call(accounts[3]);    
        }).then(function(balance) {
          assert.equal(balance.toNumber(), 1e16);
          // Check sending account no longer has a drop
          return td.dropCount(accounts[3]);
        }).then(function(count) {
          assert.equal(count.toNumber(), 0);
        });
      });
    });
  });
});
