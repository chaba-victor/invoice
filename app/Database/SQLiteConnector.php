<?php

namespace Crater\Database;

use Illuminate\Database\Connectors\SQLiteConnector as BaseSQLiteConnector;

class SQLiteConnector extends BaseSQLiteConnector
{
    /**
     * Establish a database connection.
     *
     * The desktop app's web server and scheduler are separate processes sharing
     * one database file, so wait for locks instead of failing immediately and use
     * WAL so reads aren't blocked while another process writes.
     *
     * @param  array  $config
     * @return \PDO
     */
    public function connect(array $config)
    {
        $connection = parent::connect($config);

        if ($config['database'] !== ':memory:') {
            $connection->exec('PRAGMA busy_timeout = '.(int) ($config['busy_timeout'] ?? 5000));
            $connection->exec('PRAGMA journal_mode = WAL');
        }

        return $connection;
    }
}
