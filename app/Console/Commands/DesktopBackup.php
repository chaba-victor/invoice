<?php

namespace Crater\Console\Commands;

use Crater\Models\Company;
use Crater\Models\Invoice;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use ZipArchive;

class DesktopBackup extends Command
{
    /**
     * Backup format written into manifest.json; desktop:restore checks it.
     */
    public const FORMAT = 1;

    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'desktop:backup {path : Where to write the backup (.zip)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Write a backup of the desktop app data (database, uploaded files, app key) to a zip file.';

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $dataDir = getenv('INVOICE_DATA_DIR');

        if (! $dataDir) {
            $this->error('desktop:backup only runs in the desktop app (INVOICE_DATA_DIR is not set).');

            return 1;
        }

        $path = $this->argument('path');
        $partial = $path.'.partial';
        $snapshot = $dataDir.'/backup-snapshot-'.uniqid().'.sqlite';

        try {
            // A consistent copy even while the app is running and writing.
            DB::statement('VACUUM INTO ?', [$snapshot]);

            File::ensureDirectoryExists(dirname($path));
            $zip = new ZipArchive();

            if ($zip->open($partial, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                throw new \RuntimeException("Could not create {$path}");
            }

            $zip->addFromString('manifest.json', json_encode($this->manifest(), JSON_PRETTY_PRINT));
            $zip->addFile($snapshot, 'database.sqlite');
            // APP_KEY: restoring onto another computer keeps anything encrypted with it readable.
            $zip->addFile(app()->environmentFilePath(), '.env');

            $storage = storage_path('app');
            foreach (File::allFiles($storage) as $file) {
                $zip->addFile($file->getPathname(), 'storage/app/'.str_replace('\\', '/', $file->getRelativePathname()));
            }

            if (! $zip->close()) {
                throw new \RuntimeException("Could not write {$path}");
            }

            File::delete($path);
            File::move($partial, $path);
        } catch (\Throwable $e) {
            File::delete($partial);
            $this->line('DESKTOP_REPORT '.json_encode(['ok' => false, 'error' => $e->getMessage()]));

            return 1;
        } finally {
            File::delete($snapshot);
        }

        $this->line('DESKTOP_REPORT '.json_encode(['ok' => true, 'path' => $path, 'size' => filesize($path)]));

        return 0;
    }

    /**
     * Describes the backup, for restore checks and for the restore confirmation.
     *
     * @return array
     */
    protected function manifest()
    {
        return [
            'app' => 'Invoice',
            'format' => self::FORMAT,
            'app_version' => getenv('INVOICE_APP_VERSION') ?: null,
            'created_at' => now()->toIso8601String(),
            // Restoring into an app that lacks this migration would mean an older app on a newer schema.
            'latest_migration' => DB::table('migrations')->orderByDesc('id')->value('migration'),
            'companies' => Company::pluck('name')->all(),
            'invoices' => Invoice::count(),
        ];
    }
}
