# Spec Delta

## Purpose

Keeps the machine from going to idle sleep while agent sessions are busy, so a long-running agent is not suspended
mid-turn while the user is away — and lets the machine sleep again as soon as no agent is busy.

## ADDED Requirements

### Requirement: A busy agent session keeps the machine from idle sleep

While keep-awake is on and available (see the requirements below), the server SHALL prevent the operating system's
**idle** system sleep for as long as at least one agent session is **busy**, and SHALL stop preventing it once no
session is busy.

A session is busy while its agent process runs and either

- the agent's current report (as defined by "An agent can report its state through a file" in `agent-sessions`) is
  `working`, or
- there is no current report and its terminal produced output that counts as activity (as defined in `agent-sessions`)
  within the last five minutes.

A current `waiting` report, a terminal silent for longer than five minutes without a current `working` report, and an
ended, exited or failed session SHALL NOT count as busy. Every kind of agent session counts the same way: change
sessions, the main console, project consoles and integrations. The decision MUST NOT use anything but those times and
the agent's report: the agent's output MUST NOT be read for it, exactly as for the session badge.

The server SHALL re-evaluate whether any session is busy when a session starts, when a session ends, when the setting
changes, and at least once a minute while any session runs, so that the machine is released at most one minute after
the last session stopped being busy, and at once when the last running session ends. While no session runs, no timer
SHALL run for it.

#### Scenario: Agent working keeps the machine awake
- **WHEN** keep-awake is on on macOS and a session's terminal printed output that counts as activity a minute ago
- **THEN** idle system sleep is prevented

#### Scenario: Silent terminal releases the machine
- **WHEN** the only running session has no current report and its terminal has been silent for six minutes
- **THEN** idle system sleep is no longer prevented

#### Scenario: Reported working keeps it awake through silence
- **WHEN** the only running session's agent reported `working` after the user's last input and its terminal has been
  silent for twenty minutes
- **THEN** idle system sleep is still prevented

#### Scenario: Reported waiting releases it
- **WHEN** the only running session's agent reports `waiting`, although its terminal printed output ten seconds ago
- **THEN** idle system sleep is no longer prevented within one minute

#### Scenario: Last session ends
- **WHEN** the only busy session's agent exits
- **THEN** idle system sleep is no longer prevented, without waiting for the next periodic evaluation

#### Scenario: Several sessions
- **WHEN** two sessions are busy and one of them ends
- **THEN** idle system sleep stays prevented, and only one assertion is held for both

### Requirement: Keep-awake only prevents idle sleep, only on macOS, and never outlives the server

On macOS, keep-awake SHALL be implemented by running the system's own `/usr/bin/caffeinate` with only the options that
prevent idle system sleep and that make it end on its own when the server's process ends, started without a shell,
with no input, its output discarded and its working directory in the dashboard home; it SHALL be ended to release the
machine. At most one such process SHALL run at any time. It MUST NOT keep the display awake, MUST NOT prevent sleep the
user asks for or that closing the lid causes, and MUST NOT change or persist any power setting. When the server stops,
it SHALL end that process; if the server ends without stopping it, the process SHALL end by itself.

When the process ends without the server ending it, the server SHALL start it again at the next evaluation that finds a
session busy, at most once a minute.

On any platform other than macOS, or when `/usr/bin/caffeinate` is not an executable file, keep-awake is
**unavailable**: the server SHALL start no process for it and change nothing about sleep. Keep-awake MUST NOT write
anything to a tracked repository or outside the dashboard home, MUST NOT contact any network and MUST NOT start any
process other than the one above.

#### Scenario: Server stopped
- **WHEN** the server receives SIGTERM while it prevents idle sleep
- **THEN** the `caffeinate` process has ended before the server exits

#### Scenario: Server killed
- **WHEN** the server process is killed with SIGKILL while it prevents idle sleep
- **THEN** the `caffeinate` process ends by itself and the machine can sleep again

#### Scenario: Linux
- **WHEN** a session is busy and the server runs on Linux
- **THEN** no process is started for keep-awake and the status reports it unavailable

### Requirement: Keep-awake is a setting, on by default

The Agent sessions section of Settings SHALL show a **Keep awake while agents work** switch, saved with the Settings
draft like every other setting. It SHALL be on for a configuration without a `keepAwake` key; the configuration key
`keepAwake` SHALL be written as `false` only when the user switched it off, and no key SHALL be written while it is on.
Saving the configuration with it off SHALL release the machine at once; saving it on SHALL evaluate at once.

Below the switch Settings SHALL say, from the server's status: that the machine is kept from idle sleep right now and
for how many busy sessions, or that it is not because no agent is busy; and, when keep-awake is unavailable, that it
works on macOS only, with the switch still shown. The hint SHALL say that the display may still sleep and that closing
the lid still sleeps the machine.

#### Scenario: Default on
- **WHEN** a user opens Settings with a configuration that has no `keepAwake` key
- **THEN** Keep awake while agents work is on, and saving without touching it writes no `keepAwake` key

#### Scenario: Switched off while held
- **WHEN** the machine is kept awake for a busy session and the user switches Keep awake off and saves
- **THEN** the configuration holds `keepAwake: false` and idle system sleep is no longer prevented

#### Scenario: Hint shows the current state
- **WHEN** two sessions are busy on macOS with keep-awake on
- **THEN** the hint says the machine is being kept awake for 2 sessions
