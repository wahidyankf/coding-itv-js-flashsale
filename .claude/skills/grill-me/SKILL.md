---
name: grill-me
description: >-
  Presents a decision as mutually exclusive options with one recommendation, so a material choice is resolved
  deliberately rather than assumed. Use at a planning gate or before any irreversible choice with more than one
  defensible answer.
---

# Grill Me

A decision protocol. Its purpose is to make a choice visible, resolvable, and recorded — instead of letting it be
settled silently by whoever writes first.

## Before Asking, Inspect

Read the repository, the current state, and the surfaces the decision touches. A question the repository already answers
is not a question; it is an admission that the work of looking was skipped, and it spends the other person's attention
on nothing.

Good grilling is mostly research. The interview is short because the reading was long.

## Presenting Choices

- **Mutually exclusive.** Options that overlap cannot be chosen between, and an answer that selects two of them has
  resolved nothing.
- **Exactly one recommendation.** Not zero: withholding a view returns the judgement to the person who asked for help.
  Not two: that is the absence of a recommendation, expressed at greater length. The recommendation goes first and says
  why.
- **Real trade-offs.** Every option carries what it costs. An option list where one choice is obviously correct is not a
  decision; it is a proposal wearing a question mark.
- **Always keep an open alternative and a discussion alternative.** The listed options are the ones that were thought
  of. Without a way to say "none of these" or "let's talk about it", the answer will be one of yours instead of the
  right one.

## Shaping Each Question

- **Two to four substantive options** spanning the realistic answers. One is a confirmation; five or more means the
  field was never narrowed. Both standing alternatives come on top.
- **A trade-off written for this decision,** one sentence each. "Simpler" fits every option and separates none.
- **The recommendation marked in its own label,** with a reason from the repository or a stated constraint, never left
  to position.
- **One decision per question, asked in turn.** Ask a constraining decision first, so the next options reflect its
  answer. A bundled question records a second decision nobody made.

## Answers Off the List

A written-in answer weighs the same as a listed one, and any branch it opens is questioned before moving on. Choosing
discussion sets the options aside until the person is ready to choose.

## The Asking Mechanism

Use `AskUserQuestion` whenever the session can ask interactively, since it returns a structured choice. Its free-text
"Other" entry counts as the open alternative. Without it, write the same complete question as text and wait.

A selector too small for the question never trims an option or an alternative: group the options into two branches, ask
for a branch, then ask within it, each stage recommending one.

## Asked From a Delegated Agent

A delegated agent may have no way to reach the person, so it never asks. It returns each open decision to its caller,
with a stable identifier, the question, every option with an identifier and trade-off, and the recommendation with its
reason, then stops before dependent work.

The caller passes each answer back unchanged: the selected identifier, or the written-in text as given. Before relying
on answers, the agent confirms each decision is answered once, each identifier is one it offered, and no written-in
answer is empty; otherwise it asks for a corrected answer instead of repairing one.

## Resolving

Every material branch closes. A branch left open is not deferred to a better moment — it is deferred to whoever hits it
mid-execution, with less context and more pressure.

A branch that turns out not to be material is closed by saying so, not by ignoring it.

## Recording

Write down the selected option and why. In the plan, the delivery record, or the commit — somewhere durable.

Conversation is neither durable nor shared. The question that arrives later is always the same one: was this considered
or overlooked? Only a written record can answer it, and by then nobody remembers.

## What This Is Not

Not a checklist to run before proceeding, and not a way to obtain agreement for something already decided. A gate whose
recommendation was always going to be chosen is theatre, and it costs the credibility of the next real one.
