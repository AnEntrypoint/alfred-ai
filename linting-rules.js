#!/usr/bin/env node

export const LINTING_RULES = {
  javascript: [
    {
      name: 'console-statements',
      pattern: 'console.log($$$)',
      message: 'Console statement found - should be removed for production',
      severity: 'warning'
    },
    {
      name: 'debugger-statements',
      pattern: 'debugger',
      message: 'Debugger statement found - must be removed before production',
      severity: 'error'
    },
    {
      name: 'var-declarations',
      pattern: 'var $NAME',
      message: 'Use const or let instead of var for better scoping',
      severity: 'warning'
    },
    {
      name: 'todo-comments',
      pattern: '// TODO',
      message: 'TODO comment found - should be addressed',
      severity: 'info'
    },
    {
      name: 'fixme-comments',
      pattern: '// FIXME',
      message: 'FIXME comment found - should be addressed',
      severity: 'warning'
    }
  ],

  react: [
    {
      name: 'console-in-react',
      pattern: 'console.log($$$)',
      message: 'Console statement in React component',
      severity: 'warning'
    },
    {
      name: 'react-keys-missing',
      pattern: '{$$$}.map($ITEM => <$COMPONENT $$$)',
      message: 'Array.map without key prop - React performance issue',
      severity: 'warning'
    }
  ],

  universal: [
    {
      name: 'hardcoded-secrets',
      pattern: 'api_key|secret|password|token',
      message: 'Potential hardcoded secret detected',
      severity: 'error'
    }
  ]
};

export default LINTING_RULES;
