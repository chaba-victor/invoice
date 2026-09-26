<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;

class NativeAppServiceProvider extends ServiceProvider
{
    /**
     * Boot the NativePHP Desktop application service provider.
     */
    public function boot()
    {
        // Ensure local SQLite database file exists for 100% self-contained desktop use
        $dbPath = config('nativephp.database.database', database_path('database.sqlite'));

        if (!File::exists($dbPath)) {
            File::ensureDirectoryExists(dirname($dbPath));
            File::put($dbPath, '');
        }

        // Run migrations automatically on desktop launch
        try {
            Artisan::call('migrate', [
                '--force' => true,
            ]);
        } catch (\Throwable $e) {
            logger()->error('NativePHP Desktop Migration Error: ' . $e->getMessage());
        }
    }
}
