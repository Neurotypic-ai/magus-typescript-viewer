# Design System Package Agent

## Overview

Guidance for component libraries with Storybook, design tokens, and accessibility.

## Directory Structure

- `src/components/` - Vue components with co-located files
- `src/tokens/` - Design tokens (CSS custom properties)
- `src/stores/` - UI stores (theme, toast)
- `src/constants/` - Animation configs, shared values
- `.storybook/` - Storybook configuration

## Component Co-location Pattern

Each component has its own directory:

```text
ComponentName/
├── ComponentName.vue         # Component implementation
├── ComponentName.types.ts    # TypeScript interfaces
├── ComponentName.stories.ts  # Storybook stories
├── ComponentName.docs.mdx    # Documentation
└── ComponentName.test.ts     # Unit tests
```

## Component Template

```vue
<script setup lang="ts">
import type { ComponentNameProps } from './ComponentName.types';

const props = withDefaults(defineProps<ComponentNameProps>(), {
  variant: 'default',
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <div :class="computedClasses">
    <slot />
  </div>
</template>
```

## Storybook Story Pattern

```typescript
import type { Meta, StoryObj } from '@storybook/vue3';
import ComponentName from './ComponentName.vue';

const meta: Meta<typeof ComponentName> = {
  title: 'Components/ComponentName',
  component: ComponentName,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'primary'] },
  },
};

export default meta;
type Story = StoryObj<typeof ComponentName>;

export const Default: Story = {
  args: { variant: 'default' },
};
```

## Theme Architecture

### Theme Store

```typescript
export const useThemeStore = defineStore('theme', () => {
  const theme = ref<'light' | 'dark' | 'system'>('system');

  const resolvedTheme = computed(() => {
    if (theme.value === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme.value;
  });

  function setTheme(newTheme: typeof theme.value) {
    theme.value = newTheme;
    localStorage.setItem('theme', newTheme);
  }

  return { theme, resolvedTheme, setTheme };
});
```

## Design Tokens

- Colors with semantic naming (`--color-primary`, `--color-text-muted`)
- Typography scale (`--font-size-sm`, `--font-size-lg`)
- Spacing (`--spacing-1`, `--spacing-4`)
- Motion (`--duration-fast`, `--ease-out`)

## Accessibility Requirements

- All interactive elements have focus states
- ARIA attributes where needed
- Keyboard navigation support
- Color contrast ratios (WCAG AA minimum)
- Screen reader testing

## Critical Rules

- All components MUST have Storybook stories
- No hardcoded colors/spacing (use tokens)
- Components use Tailwind with token-based classes
- Accessibility testing required
