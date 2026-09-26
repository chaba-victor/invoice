<?php

namespace Crater\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

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
    protected $description = 'Prepare the desktop data directory before migrations run.';

    /**
     * Execute the console command.
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

        return 0;
    }
}
