import React from 'react';
import { Eye, FileText } from 'lucide-react';
import Link from 'next/link';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans selection:bg-blue-100 selection:text-blue-900">
      <header className="max-w-4xl mx-auto px-6 py-8 flex items-center gap-2 font-bold text-2xl text-slate-900 dark:text-white">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Eye className="text-blue-600" size={32} />
          Legible Links
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 text-slate-800 dark:text-slate-200 leading-relaxed">
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-4 mb-8 text-blue-600">
            <FileText size={40} />
            <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">Terms of Service</h1>
          </div>
          <p className="mb-6 text-sm text-slate-500">Last Updated: April 2026</p>

          <div className="space-y-8">
            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">1. Acceptance of Terms</h2>
              <p>
                By downloading, installing, or using the Legible Links browser extension or API services, you agree to be bound by these Terms of Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">2. Acceptable Use</h2>
              <p className="mb-4">
                Legible Links provides a public utility for resolving URLs. You agree not to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Reverse engineer, decompile, or disassemble the extension or backend services.</li>
                <li>Use automated scripts, bots, or scrapers to bulk-resolve URLs against our public API.</li>
                <li>Intentionally overload or attempt to crash our infrastructure (Denial of Service).</li>
              </ul>
              <p className="mt-4">
                We reserve the right to rate-limit or permanently block IP addresses that exhibit abusive behavior.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">3. &quot;As-Is&quot; Software</h2>
              <p>
                THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. Legible Links does not guarantee 100% uptime or that every URL will be resolved correctly.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">4. Limitation of Liability</h2>
              <p>
                IN NO EVENT SHALL LEGIBLE LINKS OR ITS CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">5. Changes to Terms</h2>
              <p>
                We may update these terms occasionally. Continued use of the service constitutes acceptance of any updated terms.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
