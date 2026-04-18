# Madrid chunk seed generation prompt

Prompt used to author the initial target chunks for Habla Practice scenarios. Run against an LLM capable of producing authentic colloquial Madrid Spanish. The output is pasted directly into `backend/src/habla/db/seed.py`.

---

## Role

You generate target chunks for a Spanish language practice tool. The product is a total-immersion voice-agent role-play app — **no English appears anywhere in the learner-facing surface, including glosses**. The learner is an adult who already recognises Spanish passively and is activating colloquial Madrid Spanish at a conversational level.

## What you are producing

For each scenario, produce **6 target chunks**. A chunk is a short utterance the **learner** says during the role-play — not something the voice agent says to them. The chunk is what the post-session judge will look for in the transcript.

Each chunk is a Python dict:

```python
{"text_es": "…", "gloss_es": "…", "tags": ["…", "…"]}
```

- `text_es` — the chunk itself. 2–8 words. Single utterance. Colloquial Madrid Spanish.
- `gloss_es` — a **Spanish-only** paraphrase shown in the management UI. Describes when/why the learner would say it. 3–10 words. Never use English.
- `tags` — 1–3 tags from the controlled list below.

## Register and lexicon

- **Colloquial Madrid Spanish.** Diminutives where natural (`cañita`, `cortadito`, `un ratito`). Elision where a local would elide (`pa'` for `para`, `na'` for `nada` in casual speech — use sparingly).
- **`tú` by default.** Use `usted` only where the scenario genuinely calls for it (landlord, doctor, older shopkeeper) and even then it's a judgment call.
- **Avoid Latin-American lexicon**: no `carro` (→ `coche`), `jugo` (→ `zumo`), `frijoles` (→ `judías`), `papa` (→ `patata`), `piscina/alberca` — use `piscina`, `ustedes` as a default second-person-plural — use `vosotros`.
- **No voseo.** Ever.
- **Avoid textbook phrasings**: no `Quisiera pedir…`, `¿Me permite…?`, `Tendría la bondad de…` unless the scenario is explicitly formal.
- **Avoid empty politeness scaffolding**: `Por favor` is fine once per chunk set, not on every line. Madrileños often drop it.
- **Use real Madrid turns of phrase** where they fit the scenario: `venga`, `pues nada`, `oye`, `mira`, `¿qué tal?`, `tío/tía` (peer register, bar/social), `a ver`, `vale`, `hala`.

## Form constraints

- 2–8 words per chunk. Shorter is better.
- One utterance. No full dialogues.
- No English anywhere. Not in `text_es`, not in `gloss_es`, not in tags.
- Questions end with `¿…?`. Statements don't force a question mark to look approachable.
- Variety across the 6 chunks: don't repeat the same sentence frame. Mix questions, requests, closers, hedges.

## Controlled tag vocabulary

Pick 1–3 tags per chunk from this set only:

```
bar, pedir, social, calle, tienda, precio, vivienda, queja, transporte, direcciones, casual, cortés
```

No new tags. No English tags.

## Anti-patterns (do NOT produce)

- `Me gustaría un café` — too textbook for a Madrid bar.
- `¿Podría usted decirme…?` — overcourteous for the bar, market, metro scenarios.
- `Quisiera comprar…` — formal to the point of sounding foreign.
- English in `gloss_es` — automatic fail.
- A chunk that's something the **agent** would say (`¿Qué va a ser?`, `¿Algo más?`) — the learner is the speaker.
- Multi-sentence chunks or hedged explanations.

## Output format

Return a single Python list of scenario dicts, each with a `chunks` list of 6 chunk dicts, ready to paste into `seed.py`. The four scenarios are:

1. `bar-de-barrio` / "Bar de barrio" / ☕ — ordering drinks and tapas at a neighbourhood bar. Casual register. Peer-level with the camarero/a.
2. `mercado-tienda` / "Mercado / tienda" / 🏪 — buying produce or small goods at a local shop or market. Light haggling allowed.
3. `casero-vecinos` / "Casero / vecinos" / 🏠 — dealing with the landlord or neighbours. More courteous register with casero (mix of `tú`/`usted` depending on relationship); casual with `vecinos`.
4. `metro-transporte` / "Metro / transporte" / 🚇 — getting around on public transport. Quick, direct exchanges with strangers or staff.

Format:

```python
SCENARIOS = [
    {
        "slug": "bar-de-barrio",
        "name": "Bar de barrio",
        "icon": "☕",
        "chunks": [
            {"text_es": "…", "gloss_es": "…", "tags": ["bar", "pedir"]},
            # 5 more
        ],
    },
    # 3 more scenarios
]
```

## Review checklist (apply to your own output before returning)

- [ ] Every `gloss_es` is 100% Spanish.
- [ ] No Latin-American lexicon.
- [ ] No voseo.
- [ ] No textbook overcourteousness.
- [ ] All tags are from the controlled list.
- [ ] Each scenario has 6 chunks with variety.
- [ ] Every chunk is something the learner says, not the agent.
