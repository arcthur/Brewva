# Workflow Patterns

## Sequential Workflows

For complex tasks, break operations into clear, sequential steps. It is often helpful to give Claude an overview of the process towards the beginning of SKILL.md:

```markdown
Filling a PDF form involves these steps:

1. Analyze the form (run analyze_form.py)
2. Create field mapping (edit fields.json)
3. Validate mapping (run validate_fields.py)
4. Fill the form (run fill_form.py)
5. Verify output (run verify_output.py)
```

## Checklist Workflows

When the task is brittle, high-risk, or easy to skip steps in, prefer an
explicit checklist over a loose numbered list.

Good checklist candidates:

- write workflows with user-visible side effects
- multi-run protocols that must clear preflight before continuing
- output pipelines where one missed validation step ruins the result

Pattern:

```markdown
Copy this checklist and clear it in order:

- [ ] Step 1: Resolve target and scope
- [ ] Step 2: Verify required prerequisites
- [ ] Step 3: Run the bounded workflow
- [ ] Step 4: Re-check the critical evidence
- [ ] Step 5: Emit final artifact or handoff
```

If one step is mandatory before later work, say so explicitly:

```markdown
- [ ] Step 0: Confirm target environment ⛔ BLOCKING
```

## Conditional Workflows

For tasks with branching logic, guide Claude through decision points:

```markdown
1. Determine the modification type:
   **Creating new content?** → Follow "Creation workflow" below
   **Editing existing content?** → Follow "Editing workflow" below

2. Creation workflow: [steps]
3. Editing workflow: [steps]
```

## Confirmation Gates

For workflows that may mutate external state, publish something, or commit to a
low-reversibility output, add a confirmation gate before the side effect.

Use a gate when:

- the workflow may write to GitHub, CI, or another external system
- the workflow may generate an artifact the user is expected to adopt
- the workflow may continue down the wrong branch if one hidden assumption is wrong

Pattern:

```markdown
### Confirmation Gate

Before performing the write or publish step, restate:

1. exact target
2. exact action
3. evidence that justifies the action

If the user did not explicitly request the side effect, stop at a draft artifact
or recommendation instead of executing the write.
```
