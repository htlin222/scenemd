# Scoring the boundary

## The objective

Each candidate boundary receives a scalar quality score.

$$
Q(b) = \sum_{i} w_i \cdot f_i(b) - \sum_{j} p_j \cdot g_j(b)
$$

Positive terms reward coherence and balance, penalties punish fragmentation and crowding.

## Density distance

The density term measures distance from the target fill ratio.

$$
f_{\text{density}}(b) = 1 - \left| \frac{h_{\text{used}}(b)}{h_{\text{capacity}}} - \tau \right|
$$

where the target $\tau$ depends on the density mode.

## Stability

$$
f_{\text{stability}}(b) = \mathbb{1}[b \in B_{\text{prev}}]
$$

A boundary that existed in the previous plan earns a bonus, which keeps minor edits from reflowing the entire deck.

## The claim

Under mild assumptions the greedy scan is not optimal, and the gap is bounded by the score of the worst forced tail scene:

$$
Q_{\text{greedy}} \geq Q_{\text{opt}} - \max_{s \in \text{tail}} \left( Q_{\text{opt}}(s) - Q(s) \right)
$$

Inline forms like $O(n^2)$ and $\tau = 0.65$ must render at text size without disturbing line height.
