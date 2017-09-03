# Token drop

The problem: Handing out tokens is problematic, because the receiving account also needs enough ether to send a transaction transferring the tokens to the user's account.

The solution: Send the tokens using a 'token drop'. The recipient of the tokens can claim them from the account by signing a message authorising transfer of the tokens to a different account.

This repository implements both the token drop contract and a straightforward DApp for interfacing with it.

## Issuing

 1. Generate a series of accounts (eg, using a mnemonic generator)
 2. Add an ERC20 authorisation for the TokenDrop contract
    sufficient to cover the number of tokens being distributed.
 3. Call TokenDrop.deposit() with the list of account addresses,
    the ERC20 token address, and the number of tokens to allocate to each address.

## Redemption

 1. Call `TokenDrop.dropCount(account)` to determine how many drops the account has,
    and fetch their data with `TokenDrop.getDrop(account, idx)`.
 2. Have the owning account sign a message consisting of
    `(token_drop_address, recipient, dropId)`.
 3. From any account, call `TokenDrop.redeemFor` or
    `TokenDrop.redeem` with the drop ID, the index, the recipient
    (optional), and the signature from step 1.

## Efficiency

With token drops:

 - 125k gas + 44k gas per address to create a drop
 - 48k gas to redeem a drop
 - **Total: 92k gas per address, 44k of which is paid by sender**
 - 1 transaction plus 1 transaction per 100 addresses to fund

Without token drops:

 - 46k gas per address to transfer tokens
 - 46k gas per address to redeem the tokens
 - 21k gas to send the 'gas money'
 - **Total: 113k gas per address, all paid by sender**
 - 2 transactions per address to fund
