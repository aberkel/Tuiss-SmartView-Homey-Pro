'use strict';

// Button sub-capabilities do not generate automatic Flow cards. Calibration
// belongs in the device maintenance controls, away from normal movement.
const controls = [
  { id: 'button.limits_start', action: 'start', title: 'Set limits',
    desc: 'Replace both motor limits. Stay with the blind and keep its path clear. Close the Tuiss app, pause Flows, then save both endpoints using the step and save buttons.' },
  { id: 'button.limits_up', action: 'up', title: 'Step up',
    desc: 'Move one small step up during limit setup. Direction follows Reverse direction. Start Set limits first.' },
  { id: 'button.limits_down', action: 'down', title: 'Step down',
    desc: 'Move one small step down during limit setup. Direction follows Reverse direction. Start Set limits first.' },
  { id: 'button.limits_save', action: 'save', title: 'Save limit',
    desc: 'Save the current endpoint during setup. Read the Set limits description for the current step. Both endpoints must be saved in sequence.' },
  { id: 'button.limits_end', action: 'close', title: 'Stop setup',
    desc: 'Stop the motor and end setup. This does not restore the old limits. If interrupted, configure both endpoints again.' },
];

function options(control) {
  return { maintenanceAction: true, preventInsights: true, preventTag: true,
    title: { en: control.title, nl: control.title }, desc: { en: control.desc, nl: control.desc } };
}

function progress(owner, incomplete) {
  if (!owner) return incomplete
    ? 'Previous setup was interrupted. Start Set limits and configure both endpoints again, or use the Tuiss app.' : null;
  if (owner.phase === 'connecting') return 'Connecting to the motor. Wait until Save limit shows an endpoint. Stop setup can cancel.';
  if (['lower', 'upper'].includes(owner.phase)) {
    const lower = (owner.phase === 'lower') !== owner.inverted;
    const endpoint = lower ? 'lower / closed' : 'upper / open';
    return `Step ${owner.phase === 'lower' ? 1 : 2} of 2: use Step up / Step down to reach the ${endpoint} endpoint, then save it.`;
  }
  if (owner.phase === 'done') return 'Both limit commands were sent. Watch the blind and check open, closed and a middle position. Press Set limits only to begin another setup.';
  if (owner.phase === 'failed') return `Setup ended: ${owner.error || 'interrupted'}. ${incomplete ? 'Configure both endpoints again.' : 'Press Set limits to try again.'}`;
  return null;
}

module.exports = { controls, options, progress };
