# Token drop

The problem: Handing out tokens is problematic, because the receiving account also needs enough ether to send a transaction transferring the tokens to the user's account.

The solution: Send the tokens using a 'token drop'. The recipient of the tokens can claim them from the account by signing a message authorising transfer of the tokens to a different account.

Issuing:

 1. Generate a series of accounts (eg, using a mnemonic generator)
 2. Add an ERC20 authorisation for the TokenDrop contract
    sufficient to cover the number of tokens being distributed.
 3. Call TokenDrop.deposit() with the list of account addresses,
    the ERC20 token address, and the number of tokens to allocate to each address.

Redemption:

 1. Find the `Creation` event(s) for the account holder, and record their `token`
    and `id` fields.
 2. Have the user sign a message consisting of
    `(token_drop_address, token_address, id, recipient)`.
 3. From any account, call `TokenDrop.redeemFor` or
    `TokenDrop.redeem` with the ERC20 token address, the id, the recipient
    (optional), the drop ID, and the signature from step 1.

This repository implements both the token drop contract and a straightforward DApp for interfacing with it.
