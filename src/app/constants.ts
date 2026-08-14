// Large text constants kept out of App.tsx for readability.

export const DEMO_MARKDOWN = `# Acute Myeloid Leukemia

AML is a clonal hematopoietic malignancy characterized by abnormal proliferation of myeloid precursor cells.

## Diagnosis

Diagnosis requires integration of morphology, immunophenotyping, cytogenetics, and molecular genetics.

- Morphology
- Flow cytometry
- Cytogenetics
- Molecular testing

![Microscopic cellular structure](https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&w=1200&q=85)

## Classification

Modern AML classification increasingly incorporates molecular genetics and disease-defining genomic alterations.

> Classification is no longer only what the cells look like. It is what the disease means biologically.

## Treatment

Treatment depends on age, fitness, disease biology, and targetable mutations.

<!-- present: step -->
- Assess patient fitness
- Define molecular risk
- Identify targetable mutations
- Select induction strategy

## Risk model

| Signal | Interpretation |
| --- | --- |
| Favorable genetics | Lower relapse risk |
| Adverse genetics | Consider transplant strategy |

$$
Risk = f(Genetics, Fitness, Response)
$$

<!-- present: break -->
## Take-home message

Treat the patient, the biology, and the trajectory — not a single snapshot.
`

export const SCENEMD_LLM_PROMPT = `Convert the source content I provide into presentation-ready Markdown for SceneMD.

Return only the finished Markdown, without an explanation or an outer code fence.

Rules:
- Preserve the meaning, facts, citations, links, and important nuance. Do not invent information.
- Write an ordinary, coherent document—not a list of manually defined slides.
- Use one H1 (#) for each major chapter, H2 (##) for sections, and H3 (###) only when genuinely useful.
- Prefer short paragraphs and concise bullet lists. Each bullet should express one idea.
- Keep headings descriptive and avoid orphan headings.
- Use valid GitHub Flavored Markdown for lists, task lists, blockquotes, links, code fences, and tables.
- For tabular information, use a GFM table with a short header row. Keep cells concise; move lengthy explanations below the table.
- Images: ![alt text](full-https-url) with the bracket text used ONLY for accessibility. Put the visible caption as plain text in the same paragraph, on the line directly below the image—SceneMD renders it as the figure legend and keeps the pair together. Optionally size the figure with an attribute block immediately after the closing parenthesis, e.g. ![alt](url){size=40%}, where size is the share of the scene the figure occupies. Do not use relative image URLs.
- Cite sources in the text as adjacent numeric markers such as [1][2]. End with a ### References section containing a numbered list; include each DOI as doi:10.xxxx/xxxx or PubMed identifier as PMID: 12345678 so SceneMD can resolve AMA metadata.
- Use display math as $$ ... $$ and fenced code blocks with a language identifier.
- Do not add YAML frontmatter. SceneMD cover metadata and visual theme are configured separately.
- A horizontal rule (---) forces a scene break, exactly like <!-- present: break -->. SceneMD plans scenes automatically, so use either only when a break genuinely matters; never insert them merely to paginate.
- Add presentation hints only when they materially improve delivery, and place each hint immediately before the affected block:
  <!-- present: break --> forces a scene break.
  <!-- present: keep --> keeps the next block together.
  <!-- present: hero --> makes the next image a full-height figure (equivalent to {size=100%}).
  <!-- present: hide --> hides the next block during presentation.
  <!-- present: only --> shows the next block only during presentation.
  <!-- present: step --> reveals the following list item by item.
  <!-- present: group --> keeps everything until <!-- present: end-group --> on one scene as an atomic unit. Use sparingly; oversized groups shrink to fit.
  <!-- present: columns --> starts responsive semantic columns. Use an H3 subtitle for each column (or <!-- present: column --> for an untitled one), then close with <!-- present: end-columns -->.
- Use an ordinary Marp-compatible HTML comment after scene content for speaker notes, for example <!-- Pause here and emphasize the risk difference. -->. Do not put audience-facing content in the note.
- Use <!-- present: step --> sparingly for ordered speaking sequences, not every list.
- Do not include "Scene 1", "Slide 1", speaker instructions, or layout coordinates.

Source content begins below:

[PASTE SOURCE CONTENT HERE]`

