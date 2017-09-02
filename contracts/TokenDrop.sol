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
 * Redeeming:
 *  1. Find the `Creation` event(s) for the account holder, and record their `token`
 *     and `id` fields.
 *  2. Have the user sign a message consisting of
 *     `(token_drop_address, token_address, id, recipient)`.
 *  3. From any account, call `TokenDrop.redeemFor` or
 *     `TokenDrop.redeem` with the ERC20 token address, the id, the recipient
 *     (optional), the drop ID, and the signature from step 1.
 */
contract TokenDrop {
    event Creation(address indexed owner, address indexed token, uint dropId, uint quantity);
    event Redemption(address indexed owner, address indexed token, uint indexed dropId,
                     address recipient, uint quantity);
    
    // mapping(owner => mapping(token => mapping(id => quantity)))
    mapping(address => mapping(address => mapping(uint => uint))) public drops;
    
    uint public nextId;

    /**
     * @dev Credits tokens to a list of accounts. The caller must first
     *      provide this contract with an allowance equal to the required
     *      number of tokens.
     * @param token The address of the token contract.
     * @param addresses The list of addresses to credit tokens to.
     * @param quantity The number of tokens to issue to each address.
     */
    function deposit(IERC20Token token, address[] addresses, uint quantity) {
        // Transfer the required number of tokens to us
        assert(token.transferFrom(msg.sender, this, quantity * addresses.length));

        for(uint i = 0; i < addresses.length; i++) {
            var owner = addresses[i];
            assert(drops[owner][token][nextId] == 0);
            drops[owner][token][nextId] = quantity;
            Creation(owner, token, nextId, quantity);
        }
        nextId++;
    }

    /**
     * @dev Returns the signature hash required to authorise a transfer.
     * @param token The token being transferred.
     * @param recipient The address of the recipient of the transfer.
     * @param dropId The dropId of the drop being transferred.
     */
    function computeSignaturehash(IERC20Token token, address recipient, uint dropId) constant returns(bytes32) {
        return sha3(address(this), address(token), recipient, dropId);
    }
    
    function recover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) constant returns(address) {
        return ecrecover(hash, v, r, s);
    }

    /**
     * @dev Redeems tokens associated with an account, transferring the tokens to
     *      a new address.
     * @param recipient The address to send the tokens to.
     * @param token The address of the token being redeemed.
     * @param v (r, s) The ECDSA signature of (tokendrop_address, token_address, id, 
     *        recipient) by an account that owns tokens for the relevant drop.
     */
    function redeemFor(IERC20Token token, address recipient, uint dropId, uint8 v, bytes32 r, bytes32 s) {
        var hash = computeSignaturehash(token, recipient, dropId);
        var owner = ecrecover(hash, v, r, s);
        var quantity = drops[owner][token][dropId];

        //assert(quantity > 0);
        delete drops[owner][token][dropId];
        
        Redemption(owner, token, dropId, recipient, quantity);
        assert(token.transfer(recipient, quantity));
    }
    
    /**
     * @dev Redeems tokens associated with an account, sending the tokens to the caller.
     * @param token The address of the token being redeemed.
     * @param v (r, s) The ECDSA signature from a valid account address authorising
     *          the transfer.
     */
    function redeem(IERC20Token token, uint dropId, uint8 v, bytes32 r, bytes32 s) {
        redeemFor(token, msg.sender, dropId, v, r, s);
    }
    
    /**
     * @dev Withdraws tokens owned by the sending account directly, without need
     *      for a signature.
     * @param token The address of the token being withdrawn.
    */
    function withdraw(IERC20Token token, uint dropId) {
        var quantity = drops[msg.sender][token][dropId];
        assert(quantity > 0);
        delete drops[msg.sender][token][dropId];
        
        Redemption(msg.sender, token, dropId, msg.sender, quantity);
        assert(token.transfer(msg.sender, quantity));
    }
}
