function labelString(labels) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return '';
  const body = entries
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');
  return `{${body}}`;
}

export class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
  }

  inc(name, labels = {}, value = 1) {
    const key = `${name}${labelString(labels)}`;
    const current = this.counters.get(key);
    if (current) current.value += value;
    else this.counters.set(key, { name, labels, value });
  }

  set(name, value, labels = {}) {
    this.gauges.set(`${name}${labelString(labels)}`, { name, labels, value });
  }

  render() {
    const lines = [];
    const seenTypes = new Set();
    for (const { name, labels, value } of this.counters.values()) {
      if (!seenTypes.has(`counter:${name}`)) {
        lines.push(`# HELP ${name} counter`);
        lines.push(`# TYPE ${name} counter`);
        seenTypes.add(`counter:${name}`);
      }
      lines.push(`${name}${labelString(labels)} ${value}`);
    }
    for (const { name, labels, value } of this.gauges.values()) {
      if (!seenTypes.has(`gauge:${name}`)) {
        lines.push(`# HELP ${name} gauge`);
        lines.push(`# TYPE ${name} gauge`);
        seenTypes.add(`gauge:${name}`);
      }
      lines.push(`${name}${labelString(labels)} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }
}