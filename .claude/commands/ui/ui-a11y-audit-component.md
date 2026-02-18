# Accessibility Audit Component

Perform a comprehensive accessibility audit and implement fixes for a Vue component.

## Input Needed

- **Component path**: Path to the component to audit
- **Known issues**: Any specific a11y problems already identified

## Files to Touch

- The target component file
- Related test file (to add a11y test cases)

## Instructions

1. **Read the rules first**:
   - [a11y.mdc](mdc:.cursor/rules/a11y.mdc) for accessibility requirements
   - [unit-testing.mdc](mdc:.cursor/rules/unit-testing.mdc) for a11y test patterns

2. **Audit checklist** — check each item:

   ### Semantic HTML

   - [ ] Uses `<button>` for clickable actions (not `<div @click>`)
   - [ ] Uses `<a>` or `Link` for navigation
   - [ ] Uses heading hierarchy (`<h1>`, `<h2>`, etc.) correctly
   - [ ] Uses `<nav>`, `<main>`, `<section>`, `<article>` landmarks
   - [ ] Uses `<ul>/<ol>/<li>` for lists

   ### Form Controls

   - [ ] All inputs have associated `<label>` via `for`/`id`
   - [ ] Required fields have `required` attribute or `aria-required="true"`
   - [ ] Error messages linked via `aria-describedby`
   - [ ] Invalid state indicated with `aria-invalid="true"`
   - [ ] Placeholder is not the only label

   ### Focus Management

   - [ ] All interactive elements are focusable (Tab order)
   - [ ] Focus is visible (`:focus-visible` styles)
   - [ ] Modal/dialog traps focus correctly
   - [ ] Focus returns to trigger element on close
   - [ ] Skip links provided for long pages

   ### ARIA Attributes

   - [ ] `role` attributes used correctly (not overused)
   - [ ] `aria-label` or `aria-labelledby` for icon-only buttons
   - [ ] `aria-expanded` for collapsible sections
   - [ ] `aria-current` for current navigation item
   - [ ] `aria-live` for dynamic content updates

   ### Color & Contrast

   - [ ] Text contrast ratio ≥ 4.5:1 (normal text)
   - [ ] Large text contrast ratio ≥ 3:1
   - [ ] Information not conveyed by color alone
   - [ ] Focus indicators have sufficient contrast

   ### Keyboard Navigation

   - [ ] All actions accessible via keyboard
   - [ ] Escape closes modals/dropdowns
   - [ ] Arrow keys work for menus/tabs
   - [ ] Enter/Space activate buttons

   ### Images & Icons

   - [ ] Images have `alt` text (empty `alt=""` for decorative)
   - [ ] SVG icons have `aria-hidden="true"` if decorative
   - [ ] SVG icons have `aria-label` if meaningful

3. **Common fixes**:

   **Icon-only button**:

   ```vue
   <!-- Before -->
   <button @click="close">
     <XIcon />
   </button>

   <!-- After -->
   <button @click="close" aria-label="Close">
     <XIcon aria-hidden="true" />
   </button>
   ```

   **Form field with error**:

   ```vue
   <div>
     <label :for="inputId">Email</label>
     <input
       :id="inputId"
       :aria-invalid="!!error"
       :aria-describedby="error ? errorId : undefined"
     />
     <span v-if="error" :id="errorId" role="alert">{{ error }}</span>
   </div>
   ```

   **Clickable div → button**:

   ```vue
   <!-- Before -->
   <div class="card" @click="selectItem">...</div>

   <!-- After -->
   <button class="card" @click="selectItem">...</button>
   ```

   **Dynamic content announcement**:

   ```vue
   <div aria-live="polite" aria-atomic="true">
     {{ statusMessage }}
   </div>
   ```

4. **Add a11y tests**:

   ```typescript
   it('has accessible button with label', () => {
     render(Component);
     expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
   });

   it('error message is linked via aria-describedby', () => {
     render(Component, { props: { error: 'Required' } });
     const input = screen.getByRole('textbox');
     const error = screen.getByText('Required');
     expect(input.getAttribute('aria-describedby')).toBe(error.id);
   });

   it('invalid state is announced', () => {
     render(Component, { props: { error: 'Invalid email' } });
     const input = screen.getByRole('textbox');
     expect(input.getAttribute('aria-invalid')).toBe('true');
   });
   ```

## Acceptance Checklist

- [ ] All interactive elements are keyboard accessible
- [ ] All form inputs have proper labels
- [ ] Error states use `aria-invalid` and `aria-describedby`
- [ ] Icon-only buttons have `aria-label`
- [ ] Focus is visible on all focusable elements
- [ ] No `<div @click>` — uses semantic elements
- [ ] Color contrast meets WCAG AA (4.5:1)
- [ ] A11y test cases added to test file
- [ ] TypeScript compiles without errors
