---
title: Зачем softmax вычитает максимум
description: Трюк в две строки, который спасает softmax от переполнения и не меняет результат.
date: 2026-11-04
tags: [math, basics]
---

:::tldr
Считайте $\operatorname{softmax}(x - \max x)$ вместо $\operatorname{softmax}(x)$. Результат тот же, а `exp` больше не переполняется.
:::

## Проблема

Softmax превращает вектор логитов $x \in \mathbb{R}^n$ в вероятности:

$$
\operatorname{softmax}(x)_i = \frac{e^{x_i}}{\sum_{j=1}^{n} e^{x_j}}
$$

В `float32` значение $e^{x}$ становится `inf` уже при $x > 88.7$. Логиты такого размера в большой модели обычное дело, а `inf / inf` даёт `nan`.

```python
import numpy as np

x = np.array([1000.0, 1001.0, 1002.0], dtype=np.float32)
np.exp(x) / np.exp(x).sum()  # array([nan, nan, nan])
```

## Решение

Вычтем из всех логитов одну и ту же константу $c$:

$$
\frac{e^{x_i - c}}{\sum_j e^{x_j - c}} = \frac{e^{-c}\, e^{x_i}}{e^{-c} \sum_j e^{x_j}} = \frac{e^{x_i}}{\sum_j e^{x_j}}
$$

При $c = \max_j x_j$ самая большая экспонента равна $e^0 = 1$, поэтому переполнения нет, а знаменатель не меньше 1, поэтому нет и деления на ноль.[^under]

```python
def softmax(x):
    z = x - x.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)

softmax(x)  # ≈ [0.090, 0.245, 0.665]
```

:::proof
Числитель и знаменатель умножаются на одно и то же ненулевое число $e^{-c}$, поэтому дробь не меняется ни при каком $i$ и любом вещественном $c$.
:::

## Log-softmax

Для cross-entropy нужен $\log \operatorname{softmax}(x)_i$. Логарифм от стабильной версии всё равно теряет точность, когда вероятность обнуляется. Вместо этого используйте тождество:

$$
\log \operatorname{softmax}(x)_i = x_i - c - \log \sum_j e^{x_j - c}
$$

:::note
Это трюк log-sum-exp. В PyTorch `log_softmax` и `cross_entropy` уже применяют его, так что передавайте им сырые логиты, а не вероятности.
:::

[^under]: Маленькие слагаемые всё ещё могут обнулиться. Здесь это безвредно: их настоящая доля в сумме и так меньше точности float.
