// Pi compatibility tests use the inherited `.pi` project layout. Prime smoke
// tests opt into `.prime/agent` explicitly through their environment.
delete process.env.PRIME_AGENT_CODING_AGENT_DIR;
