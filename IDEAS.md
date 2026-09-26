
# Project teams integration
Teams integration for project participants for meetings.

# Push notification
Push notification system for alerts. Must decide on all the alerts.

# Bayesian model for skill probability
A Beta-Binomial score per claimed skill (`user_skills` row). It gives the probability that the user really has the skill, plus how certain that probability is. No training data needed.

```
start:     α = α₀, β = β₀                  (prior, e.g. Beta(2, 2))

for each vouch on the skill:
    α += weight(voucher)

weight(voucher) = base
                × (worked on a project with the user     ? w_teammate     : 1)
                × (voucher has an entrepreneurship vouch ? w_entrepreneur : 1)

for each teammate who worked with the user but didn't vouch:
    β += λ                                  (weak negative evidence, e.g. λ = 0.2)

P(has skill) = α / (α + β)
```

- Teammates = users sharing a project in `project_participants` with the user. Their vouches count the most.
- Every vouch names the project and role (`skill_vouches.project_id`/`role_id`) it is based on, so teammate vouches are identified directly, not inferred. Admin vouches can be weighted separately.
- A user with an admin entrepreneurship vouch (`user_entrepreneurial_vouches`) starts from a slightly higher prior.
- Rank and show badges by the lower end of the credible interval, not the mean, so 1 vouch can't beat 20.
- Update in the same transaction as the vouch, like `idea_comments.score`. Possibly cache `alpha`/`beta` on `user_skills`.
- Anti-gaming: low weight for non-teammates and a cap on vouches per voucher.
- Later: when there are known answers (admin/lecturer skill assessments, tasks completed in matching categories), switch to Bayesian logistic regression to learn the weights. Only consider a Bayesian neural network if that underfits.

