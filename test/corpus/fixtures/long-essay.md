# The measurement argument

Character counts approximate width, not height. Rendered height depends on the font, the theme, the viewport, wrapping, and the presence of mathematics or media. Any paginator that guesses will be wrong at exactly the moments that matter.

The alternative is to measure. Render every block off-screen at the true viewport width, read back its height, and paginate against real geometry.

## Objections

The first objection is cost. Measurement requires a layout pass, and layout passes are not free. But the pass is incremental: only changed blocks need remeasuring, and the browser is already very good at this.

The second objection is instability. If pagination depends on measurement, then any restyling can move boundaries. This is true, and it is why a stability term belongs in the scoring function: prior boundaries should win ties.

The third objection is complexity. A measuring paginator has more moving parts than a character counter. The answer is that the complexity is real but bounded, and it lives in one place.

## The counterfactual

Consider the alternative honestly. A guessing paginator produces overfull scenes on wide content and half-empty scenes on narrow content, and its errors are invisible until presentation time.

A measuring paginator produces its errors at authoring time, where they can be seen and fixed.

## Where the argument ends

Measurement does not remove judgment. The scoring function still decides what a good boundary is, and that is a design question, not a geometric one.

What measurement removes is the pretense that geometry can be inferred from text alone. It cannot, and every slide tool that pretends otherwise ships the evidence.

## Coda

The document remains the source of truth. The measurements are ephemeral, the scenes are derived, and the argument survives every resize.
