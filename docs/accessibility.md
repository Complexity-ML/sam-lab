# Accessibility audit

SAM LAB's keyboard and visual audit targets WCAG 2.2 AA for the desktop workbench.

## Keyboard and focus

- `Alt+1` through `Alt+4` focus the card library, canvas, inspector and agent composer.
- `A`, `Delete`, `Cmd/Ctrl+S`, `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` and `F` cover the primary graph operations.
- `?` opens the discoverable shortcut reference.
- Shared modals trap `Tab`, close with `Escape`, and return focus to their launcher.
- Closed library and inspector panels use `inert`, so their controls leave the accessibility tree and tab order.

## Visual audit

The automated palette test checks the body, secondary, faint, accent-button and diagnostics-banner text in both themes against the WCAG AA 4.5:1 threshold. The Diagnostics privacy notice deliberately uses dark green text on a stable light-green surface in both themes, rather than inheriting light dark-theme text.

Motion is disabled through `prefers-reduced-motion`: animations and transitions complete in effectively zero time and smooth scrolling is removed.

## Verification

Run `npm test -- --run src/domain/accessibility.test.ts src/components/shared/Modal.test.tsx src/hooks/useKeyboardShortcuts.test.tsx`, then manually traverse the four workbench regions and Settings with only `Tab`, `Shift+Tab`, `Enter`, `Escape` and the shortcuts above.
