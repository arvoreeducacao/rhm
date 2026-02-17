---
name: database-mysql
description: MySQL database patterns. Use when querying database schema, exploring data, understanding table relationships, or debugging data issues.
triggers: [mysql, database, db, schema, query, sql, tables, migration]
---

# MySQL Database Guide

## When to Use This Skill

Use when exploring database schema, understanding data relationships, debugging data issues, writing queries, or creating migrations.

## MCP Tools

Use the MySQL MCP for read-only access:

```
list_tables  — List all tables in the database
read_query   — Execute SELECT queries (read-only)
```

## Common Patterns

### Explore Schema

```sql
SHOW TABLES;
SHOW COLUMNS FROM <table>;
DESCRIBE <table>;
SHOW INDEX FROM <table>;
```

### Understand Relationships

```sql
SELECT
  TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE REFERENCED_TABLE_NAME IS NOT NULL
  AND TABLE_SCHEMA = DATABASE();
```

### Count and Sample

```sql
SELECT COUNT(*) FROM <table> WHERE <condition>;
SELECT * FROM <table> WHERE <condition> LIMIT 10;
```

## Soft Delete Patterns

Tables may use different soft delete approaches:

| Pattern | Meaning |
|---------|---------|
| `deleted` column (0/1) | Record is soft-deleted |
| `deactivated` column | Record is deactivated |
| `disabled` column | Record is disabled |
| `active` column | Record is active (inverse) |
| `deleted_at` timestamp | Null = active, set = deleted |

Always check the appropriate status column when querying.

## Data Types

| Pattern | Type | Notes |
|---------|------|-------|
| Primary keys | `int` or `bigint` | Auto increment |
| Boolean flags | `tinyint(1)` | 0 = false, 1 = true |
| Percentages | `decimal(5,3)` | 0.000 to 100.000 |
| Timestamps | `datetime` | UTC |
| JSON data | `json` | MySQL 5.7+ native JSON |

## Security Rules

1. Never expose passwords, tokens, or API keys in query results
2. PII fields (email, name, phone) are sensitive — limit exposure
3. Always use LIMIT on exploratory queries
4. Filter inactive/deleted records unless debugging
5. Never modify data — use read-only queries only

## Debugging Queries

### Check if record exists with relationships

```sql
SELECT t1.id, t1.name,
       t2.id as related_id, t2.status
FROM main_table t1
LEFT JOIN related_table t2 ON t2.main_id = t1.id
WHERE t1.id = ?;
```

### Find duplicates

```sql
SELECT <column>, COUNT(*) as count
FROM <table>
GROUP BY <column>
HAVING count > 1;
```

### Check recent changes

```sql
SELECT * FROM <table>
WHERE updated_at >= NOW() - INTERVAL 1 HOUR
ORDER BY updated_at DESC
LIMIT 20;
```
