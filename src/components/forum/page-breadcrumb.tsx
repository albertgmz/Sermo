import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export type BreadcrumbEntry = {
  label: string;
  href?: string;
};

export function PageBreadcrumb({
  items,
  className,
}: {
  items: BreadcrumbEntry[];
  className?: string;
}) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList className="gap-x-1.5 gap-y-0">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={item.label}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-h-10 md:min-h-8">
                {item.href ? (
                  <BreadcrumbLink
                    render={<Link href={item.href} />}
                    className={cn(
                      "inline-flex min-h-10 items-center md:min-h-8",
                      last && "font-medium text-foreground",
                    )}
                  >
                    {item.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="font-medium">
                    {item.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
