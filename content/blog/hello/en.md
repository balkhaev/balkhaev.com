---
title: The blog is open
description: What this blog is for and what to expect here.
date: 2026-11-04
tags: [meta]
---

This is where I will write about machine learning: notes on papers, experiments and the code behind them.

## What to expect

- **Paper notes** — what a paper claims, how it works and where it stops working.
- **Tutorials** — building models from scratch, step by step, with runnable code.
- **Experiment reports** — what I tried, what the numbers were and what I made of them.

Posts come in English and Russian; use the switcher at the top to change the language.

```python
import torch

x = torch.randn(4, 8)
print(x.softmax(dim=-1).sum(dim=-1))  # tensor([1., 1., 1., 1.])
```

Formulas, notebooks and references are coming next.
