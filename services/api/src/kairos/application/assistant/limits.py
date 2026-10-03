"""Shared numeric limits for the assistant whitelist.

A leaf module with no imports of its own, so both the event whitelist (`tools`) and the flexible-task
schemas (`task_tools`) can read `MAX_BASIS_FRAGMENTS` without the two importing each other.
"""

MAX_BASIS_FRAGMENTS = 4
