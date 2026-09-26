<?php

namespace Crater\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

class DesktopProvision extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'desktop:provision';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Prepare the desktop app for serving: database, migrations, catch-up checks and caches.';

    /**
     * Execute the console command.
     *
     * The desktop launcher runs this once per start, in a single PHP process, before
     * starting the web server. It clears the config cache beforehand so the current
     * port and paths from its environment apply.
     *
     * @return int
     */
    public function handle()
    {
        $connection = config('database.default');
        $database = config("database.connections.{$connection}.database");

        if (config("database.connections.{$connection}.driver") === 'sqlite' && $database !== ':memory:' && ! File::exists($database)) {
            File::ensureDirectoryExists(dirname($database));
            File::put($database, '');

            $this->info("Created database {$database}");
        }

        $this->call('migrate', ['--force' => true]);

        // These are scheduled daily at midnight, when a desktop app is usually closed.
        // Both are idempotent, so run them on every start instead.
        if (Storage::disk('local')->has('database_created')) {
            $this->call('check:invoices:status');
            $this->call('check:estimates:status');
        }

        $this->call('config:cache');
        $this->call('route:cache');

        return 0;
    }
}
