# MidenDelta contracts

Foundry project. See the repository README for the architecture and roles.

```bash
forge build
forge test -vv
node script/export-abi.mjs   # copy ABIs and bytecode to keeper/src and web/src
```

Deployment runs from `keeper/` (`npm run deploy`, viem), so Foundry is only needed to change or test the contracts.

`test/Fund.t.sol` covers the acceptance criteria of the compliance-first spec: permissioned transfers, US blocking,
the EUR 200k semi-professional rules, same-identity transfers, keeper role limits, the 3x leverage cap, the redemption
gate without seniority, the net-outflow levy, circuit breakers, depositary-only withdrawals and the NAV sanity bound.
