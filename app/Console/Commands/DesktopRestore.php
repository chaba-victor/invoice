<?php

namespace Crater\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use PDO;
use ZipArchive;

class DesktopRestore extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'desktop:restore
        {path : The backup (.zip) written by desktop:backup}
        {--inspect : Only check the backup and describe it}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Replace the desktop app data with a backup. The app server must be stopped.';

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $dataDir = getenv('INVOICE_DATA_DIR');

        if (! $dataDir) {
            return $this->failWith('desktop:restore only runs in the desktop app (INVOICE_DATA_DIR is not set).');
        }

        $zip = new ZipArchive();

        if ($zip->open($this->argument('path'), ZipArchive::RDONLY) !== true) {
            return $this->failWith('This file is not an Invoice backup.');
        }

        $manifest = json_decode((string) $zip->getFromName('manifest.json'), true);

        if (! is_array($manifest) || ($manifest['app'] ?? null) !== 'Invoice' || $zip->locateName('database.sqlite') === false) {
            return $this->failWith('This file is not an Invoice backup.');
        }

        if (($manifest['format'] ?? 0) > DesktopBackup::FORMAT
            || (! empty($manifest['latest_migration']) && ! File::exists(database_path("migrations/{$manifest['latest_migration']}.php")))) {
            return $this->failWith('This backup was made by a newer version of Invoice. Update Invoice, then restore it.');
        }

        if ($this->option('inspect')) {
            $this->line('DESKTOP_REPORT '.json_encode(['ok' => true, 'manifest' => $manifest]));

            return 0;
        }

        $work = $dataDir.'/restore-'.uniqid();

        try {
            $this->extract($zip, $work);
            $zip->close();
            $this->checkDatabase($work.'/database.sqlite');
            $this->swapIn($work);
        } catch (\Throwable $e) {
            return $this->failWith($e->getMessage());
        } finally {
            File::deleteDirectory($work);
        }

        $this->line('DESKTOP_REPORT '.json_encode(['ok' => true, 'manifest' => $manifest]));

        return 0;
    }

    /**
     * Extract only the entries a backup is made of, refusing paths that could escape $work.
     */
    protected function extract(ZipArchive $zip, $work)
    {
        $entries = [];

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);

            if (Str::contains($name, ['..', '\\']) || Str::startsWith($name, '/') || Str::contains($name, ':')) {
                throw new \RuntimeException('This backup contains unexpected file paths and was not restored.');
            }

            if (in_array($name, ['database.sqlite', '.env']) || (Str::startsWith($name, 'storage/app/') && ! Str::endsWith($name, '/'))) {
                $entries[] = $name;
            }
        }

        File::ensureDirectoryExists($work);

        if (! $zip->extractTo($work, $entries)) {
            throw new \RuntimeException('The backup could not be read.');
        }
    }

    protected function checkDatabase($file)
    {
        $pdo = new PDO('sqlite:'.$file);
        $integrity = $pdo->query('PRAGMA integrity_check')->fetchColumn();
        $hasSettings = $pdo->query("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'settings'")->fetchColumn();
        $pdo = null;

        if ($integrity !== 'ok' || ! $hasSettings) {
            throw new \RuntimeException('The database in this backup is damaged and was not restored.');
        }
    }

    /**
     * Replace the live database, uploaded files and app key with the extracted backup.
     */
    protected function swapIn($work)
    {
        // Laravel may have opened the database while booting; Windows can't replace an open file.
        DB::purge();

        $database = config('database.connections.sqlite.database');

        foreach (['', '-wal', '-shm'] as $suffix) {
            File::delete($database.$suffix);
        }

        File::move($work.'/database.sqlite', $database);

        $storage = storage_path('app');
        $previous = $storage.'-replaced-'.uniqid();

        File::move($storage, $previous);
        File::isDirectory($work.'/storage/app')
            ? File::move($work.'/storage/app', $storage)
            : File::makeDirectory($storage, 0755, true);
        File::deleteDirectory($previous);

        if (File::exists($work.'/.env')) {
            File::copy($work.'/.env', app()->environmentFilePath());
        }
    }

    protected function failWith($message)
    {
        $this->line('DESKTOP_REPORT '.json_encode(['ok' => false, 'error' => $message]));

        return 1;
    }
}
