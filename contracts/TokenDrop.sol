pragma solidity ^0.4.10;

import "./IERC20Token.sol";

/**
 * The problem: Handing out tokens to users is clunky, because the receiving account
 * also needs enough ether to send a transaction transferring the tokens to the
 * user's account.
 * 
 * The solution: Send the tokens using a 'token drop'. The recipient of the
 * tokens can claim them from the account by signing a message authorising
 * transfer of the tokens to a different account.
 *
 * Issuing:
 *  1. Generate a series of accounts (eg, using a mnemonic generator)
 *  2. Add an ERC20 authorisation for the TokenDrop contract
 *     sufficient to cover the number of tokens being distributed.
 *  3. Call TokenDrop.deposit() with the list of account addresses,
 *     the ERC20 token address, and the number of tokens to allocate to each address.
 * 
 * Redemption:
 *  1. Call `TokenDrop.dropCount(account)` to determine how many drops the account has,
 *     and fetch their data with `TokenDrop.getDrop(account, idx)`.
 *  2. Have the owning account sign a message consisting of
 *     `(token_drop_address, recipient, dropId)`.
 *  3. From any account, call `TokenDrop.redeemFor` or
 *     `TokenDrop.redeem` with the drop ID, the index, the recipient
 *     (optional), and the signature from step 1.
 */
contract TokenDrop {
    event Creation(address indexed owner, address indexed token, uint quantity);
    event Redemption(address indexed owner, address indexed token,
                     address recipient, uint quantity);
    
    struct Drop {
        IERC20Token token;
        uint quantity;
        uint count;
    }

    Drop[] private drops;

    // mapping(owner => drop indexes)
    mapping(address => uint[]) private userDrops;

    /**
     * @dev Credits tokens to a list of accounts. The caller must first
     *      provide this contract with an allowance equal to the required
     *      number of tokens.
     * @param token The address of the token contract.
     * @param addresses The list of addresses to credit tokens to.
     * @param quantity The number of tokens to issue to each address.
     */
    function deposit(IERC20Token token, address[] addresses, uint quantity) public {
        // Transfer the required number of tokens to us
        assert(token.transferFrom(msg.sender, this, quantity * addresses.length));

        var dropId = drops.push(Drop(token, quantity, addresses.length)) - 1;

        for(uint i = 0; i < addresses.length; i++) {
            var owner = addresses[i];
            userDrops[owner].push(dropId);
            Creation(owner, token, quantity);
        }
    }

    /**
     * @dev Returns the number of drops an account has.
     * @param owner The owner account to query.
     * @return The number of drops belonging to the queried account.
     */
    function dropCount(address owner) public constant returns(uint) {
        return userDrops[owner].length;
    }

    /**
     * @dev Returns information about a drop belonging to a user. Note that indexes
     *      are not stable across redemptions.
     * @param owner The owner of the drop.
     * @param idx The index of the drop, between 0 and `numDrops(owner)`.
     * @return token:    The address of the token the drop is for
     *         id:       The drop ID
     *         quantity: The number of tokens
     */
    function getDrop(address owner, uint idx) public constant returns(address token, uint dropId, uint quantity) {
        dropId = userDrops[owner][idx];
        var drop = drops[dropId];
        (token, quantity) = (drop.token, drop.quantity);
    }

    /**
     * @dev Returns the signature hash required to authorise a transfer.
     * @param recipient The address of the recipient of the transfer.
     * @param dropId The dropId of the drop being transferred.
     * @return The hash the account owner should sign to authorise the transfer.
     */
    function computeSignaturehash(address recipient, uint dropId) public constant returns(bytes32) {
        return sha3(address(this), recipient, dropId);
    }

    function doRedeem(address owner, address recipient, uint dropId, uint idx) internal {
        var drop = drops[dropId];
        var dropList = userDrops[owner];
        // Check that the user actually has this drop in the specified position
        assert(dropList[idx] == dropId);

        // Delete the drop from the user's list, moving an element to fill the slot
        // if appropriate.
        if(idx < dropList.length - 1) {
            dropList[idx] = dropList[dropList.length - 1];
        }
        dropList.length--;
        
        Redemption(owner, drop.token, recipient, drop.quantity);
        assert(drop.token.transfer(recipient, drop.quantity));

        // Decrement the remaining count for this drop, deleting it if this was the
        // last one.
        drop.count--;
        if(drop.count == 0) {
            delete drops[dropId];
        }
    }
    
    /**
     * @dev Redeems tokens associated with an account, transferring the tokens to
     *      a new address.
     * @param recipient The address to send the tokens to.
     * @param dropId The drop ID being redeemed.
     * @param idx The index of the drop being redeemed.
     * @param v (r, s) The ECDSA signature of (tokendrop_address, token_address, id, 
     *        recipient) by an account that owns tokens for the relevant drop.
     */
    function redeemFor(address recipient, uint dropId, uint idx, uint8 v, bytes32 r, bytes32 s) public {
        var hash = computeSignaturehash(recipient, dropId);
        var owner = ecrecover(hash, v, r, s);
        doRedeem(owner, recipient, dropId, idx);
    }
    
    /**
     * @dev Redeems tokens associated with an account, sending the tokens to the caller.
     * @param dropId The drop ID being redeemed.
     * @param idx The index of the drop being redeemed.
     * @param v (r, s) The ECDSA signature from a valid account address authorising
     *          the transfer.
     */
    function redeem(uint dropId, uint idx, uint8 v, bytes32 r, bytes32 s) public {
        redeemFor(msg.sender, dropId, idx, v, r, s);
    }
    
    /**
     * @dev Withdraws tokens owned by the sending account directly, without need
     *      for a signature.
     * @param dropId The drop ID being redeemed.
     * @param idx The index of the drop being redeemed.
    */
    function withdraw(uint dropId, uint idx) public {
        doRedeem(msg.sender, msg.sender, dropId, idx);
    }
}
