# Tasks

## 1. Version completion confirmations

- [x] 1.1 Persist and increment the explicit completion revision per managed action; verify existing confirmations start at revision 1 and repeated confirmations advance it
- [x] 1.2 Clear the revision when a new managed action starts or terminal input invalidates completion; verify stale confirmations cannot carry forward

## 2. Expose targeted reconfirmation and status

- [x] 2.1 Show the phase confirmation action again when delivery recovery requests `confirm-complete`; verify other completion states keep their current controls
- [x] 2.2 Show only the latest delivery record per phase and suppress retry for merged work; verify stale records do not remain as actionable rows
- [x] 2.3 Add regression coverage for updated confirmation revisions and the merged/stale delivery UI states
- [x] 2.4 Keep delivery status and recovery actions at one pull-request checkpoint; suppress duplicate waiting/blocked status notices and treat “nothing to ship (merged)” as completed
- [x] 2.5 Make phase confirmation explain verification-before-Ship and show immediate accepted feedback; resolve Archive Ship from its own session independent of Console selection
- [x] 2.6 Add regression coverage for single-location delivery status and confirmation/Archive Ship action placement
