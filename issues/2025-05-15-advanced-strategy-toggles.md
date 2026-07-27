## Summary
Expose advanced mathematical strategy toggles in System Settings to control team generation strictness.

## Environment
- **Product/Service**: Heur-Aegis Dex
- **Region/Version**: v1.0.0 (Vue 3 / TypeScript)

## Expected Behavior
The "System Settings" section should include the following new controls:
1. **Allow Quadruple Damage (Toggle)**: If disabled, filter out any Pokémon combination that has a 4x weakness.
2. **Cover Weaknesses (Toggle)**: Enable/Disable the engine's synergy check (currently hardcoded to true).
3. **Allow Shared Types (Toggle)**: Allow/Disallow multiple Pokémon on a team to share a base type.
4. **Variable Team Size (Selector)**: Option to switch between Team of 3 (PvP) and Team of 6 (Classic).

## Impact
**Medium** - Enhances user control over algorithmic team generation, allowing for more specific meta-gaming strategies.

## Additional Context
These features were available in the original PokeTeamTypes app but are currently hardcoded or omitted in the new architecture.
