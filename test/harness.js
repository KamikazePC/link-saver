// A tiny test runner with no dependencies. Tests register with T.test(name, fn) and
// T.run() runs them in order, renders the results and sets <body data-status="pass|fail">
// plus a one-line summary in #summary so the headless runner can read the outcome.
(function (root) {
  'use strict';
  const tests = [];
  const TEST_TIMEOUT_MS = 5000;

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function fail(message) {
    throw new Error(message);
  }

  const show = (v) => {
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  const assert = {
    ok(value, message) {
      if (!value) fail(message || `Expected a truthy value, got ${show(value)}`);
    },
    equal(actual, expected, message) {
      if (!Object.is(actual, expected)) fail(`${message ? `${message}: ` : ''}expected ${show(expected)}, got ${show(actual)}`);
    },
    deepEqual(actual, expected, message) {
      if (show(actual) !== show(expected)) fail(`${message ? `${message}: ` : ''}expected ${show(expected)}, got ${show(actual)}`);
    },
    includes(text, part, message) {
      if (!String(text).includes(part)) fail(`${message ? `${message}: ` : ''}expected ${show(text)} to include ${show(part)}`);
    },
    async rejects(promiseOrFn, check, message) {
      let error = null;
      try {
        await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
      } catch (err) {
        error = err;
      }
      if (!error) fail(message || 'Expected a rejection, but it resolved');
      if (check) check(error);
      return error;
    },
  };

  // Waits for fn() to return something truthy (UI updates are async).
  async function until(fn, label, timeout = 2000) {
    const start = Date.now();
    for (;;) {
      const value = fn();
      if (value) return value;
      if (Date.now() - start > timeout) fail(`Timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  // A fresh element for each UI test, emptied afterwards.
  function fixture() {
    const el = document.getElementById('fixture');
    el.replaceChildren();
    return el;
  }

  async function run() {
    const out = document.getElementById('results');
    const summary = document.getElementById('summary');
    let passed = 0;
    const failures = [];

    for (const t of tests) {
      let error = null;
      let timer;
      try {
        await Promise.race([
          Promise.resolve().then(t.fn),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${TEST_TIMEOUT_MS}ms`)), TEST_TIMEOUT_MS); }),
        ]);
      } catch (err) {
        error = err;
      } finally {
        clearTimeout(timer);
        document.getElementById('fixture').replaceChildren();
      }
      const li = document.createElement('li');
      li.className = error ? 'fail' : 'pass';
      li.textContent = `${error ? '✗' : '✓'} ${t.name}${error ? ` — ${error.message}` : ''}`;
      out.append(li);
      if (error) {
        failures.push(`${t.name}: ${error.message}`);
        console.error(t.name, error);
      } else {
        passed += 1;
      }
    }

    const ok = failures.length === 0;
    summary.textContent = `${ok ? 'PASS' : 'FAIL'} ${passed}/${tests.length} tests passed`;
    summary.className = ok ? 'pass' : 'fail';
    document.body.dataset.status = ok ? 'pass' : 'fail';
    // Machine-readable copy for the headless runner.
    document.getElementById('failures').textContent = failures.join('\n');
    return ok;
  }

  root.T = { test, assert, until, fixture, run };
})(globalThis);
