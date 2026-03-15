import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

interface FAQItemProps {
  question: string;
  answer: string;
  value: string;
}

export function FAQItem({ question, answer, value }: FAQItemProps) {
  return (
    <Accordion.Item value={value} className="border-b border-[rgba(231,229,228,0.8)]">
      <Accordion.Header>
        <Accordion.Trigger className="flex justify-between items-center w-full py-6 text-left group">
          <span className="font-medium text-[16px] text-[#292524] pr-4">
            {question}
          </span>
          <ChevronDown 
            className="w-5 h-5 text-[#79716b] transition-transform duration-300 group-data-[state=open]:rotate-180" 
            strokeWidth={1.5}
          />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[accordion-up_200ms_ease-out] data-[state=open]:animate-[accordion-down_200ms_ease-out]">
        <div className="pb-6">
          <p className="text-[15px] font-light text-[#79716b] leading-[24.375px] whitespace-pre-line">
            {answer}
          </p>
        </div>
      </Accordion.Content>
    </Accordion.Item>
  );
}
