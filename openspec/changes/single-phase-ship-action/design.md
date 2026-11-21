# Design

The detail view renders a completion confirmation for a running managed session and independently renders Ship whenever that phase has unshipped work. Suppress only the direct Ship button whose delivery phase matches the active completion confirmation. Keep the confirmation status, retry controls, and other phase actions unchanged. Once there is no matching completion confirmation, the direct Ship button remains available.

Factor the phase comparison into a small pure helper so the matching and non-matching cases can be tested directly.
