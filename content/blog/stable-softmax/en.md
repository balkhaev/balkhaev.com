---
title: Why softmax subtracts the maximum
description: A two-line trick that keeps softmax from overflowing, and why it does not change the result.
date: 2026-11-04
tags: [math, basics]
---

:::tldr
Compute $\operatorname{softmax}(x - \max x)$ instead of $\operatorname{softmax}(x)$. The output is identical, and `exp` can no longer overflow.
:::

## The problem

Softmax turns a vector of logits $x \in \mathbb{R}^n$ into probabilities:

$$
\operatorname{softmax}(x)_i = \frac{e^{x_i}}{\sum_{j=1}^{n} e^{x_j}}
$$

In `float32`, $e^{x}$ overflows to `inf` once $x > 88.7$. Logits of that size are routine in a large model, and `inf / inf` gives `nan`.

```python
import numpy as np

x = np.array([1000.0, 1001.0, 1002.0], dtype=np.float32)
np.exp(x) / np.exp(x).sum()  # array([nan, nan, nan])
```

## The fix

Subtract any constant $c$ from every logit:

$$
\frac{e^{x_i - c}}{\sum_j e^{x_j - c}} = \frac{e^{-c}\, e^{x_i}}{e^{-c} \sum_j e^{x_j}} = \frac{e^{x_i}}{\sum_j e^{x_j}}
$$

With $c = \max_j x_j$ the largest exponent is $e^0 = 1$, so nothing overflows, and the denominator is at least 1, so nothing divides by zero.[^under]

```python
def softmax(x):
    z = x - x.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)

softmax(x)  # ≈ [0.090, 0.245, 0.665]
```

:::proof
Multiplying numerator and denominator by the same non-zero number $e^{-c}$ leaves the fraction unchanged, for every $i$ and any real $c$.
:::

## Log-softmax

For a cross-entropy loss you need $\log \operatorname{softmax}(x)_i$. Taking the log of the stable version still loses precision when a probability underflows to 0. Use the identity instead:

$$
\log \operatorname{softmax}(x)_i = x_i - c - \log \sum_j e^{x_j - c}
$$

:::note
This is the log-sum-exp trick. PyTorch's `log_softmax` and `cross_entropy` already apply it, so pass them raw logits rather than probabilities.
:::

[^under]: Small terms can still underflow to 0. That is harmless here, because their true share of the sum is below float precision anyway.
